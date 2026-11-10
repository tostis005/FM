import express from "express";
import {profileAllows} from "./profilePolicy.js";

// Los documentos/contactos se asocian a la identidad unificada del grupo,
// nunca al código local de una farmacia. Todas las queries incluyen cliente_slug.
const validId = value => /^[1-9][0-9]{0,17}$/.test(String(value ?? ""));
const allowed = role => ["superadministrador","administrador","gestor"].includes(role);
const canManage = req => allowed(req.context?.role);
const norm = (value,limit=200) => String(value ?? "").trim().slice(0,limit+1);
const fail = (res,error,status=400) => res.status(status).json({error});
const supplierRoot="/api/tenant/proveedores-unificados";
const categoryRoot="/api/tenant/proveedor-documento-categorias";
const fields=["fiscalId","phone","email","address","website","notes"];
const mimeTypes=new Set(["application/pdf","application/vnd.ms-excel",
 "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
 "application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document",
 "text/plain","text/csv","image/png","image/jpeg","application/octet-stream"]);
const cleanHeader = value => {try{return decodeURIComponent(String(value||""))}catch{return ""}};
const validDay = value => !value || /^\d{4}-\d{2}-\d{2}$/.test(value);
const jsonRoute = handler => async(req,res,next)=>{try{await handler(req,res)}catch(e){next(e)}};

// requireTenant ya comprueba que la sesión pertenece al cliente activo.
 // Escribir requiere un rol de gestión; consultar no exige permisos adicionales.
function writeGuard(req,res,next){
 if(!canManage(req))return fail(res,"No tienes permiso para modificar proveedores",403);
 const operation=req.method==="POST"?"crear":req.method==="DELETE"?"eliminar":"editar";
 if(req.context?.role!=="superadministrador"&&
  !profileAllows(req.context?.profilePermissions,"proveedores",operation))
  return fail(res,"Tu perfil no permite esta operación en proveedores",403);
 next();
}
async function supplier(pool,slug,id){
 if(!validId(id))return null;
 const {rows}=await pool.query(
  "SELECT id::text,nombre AS name,clase AS class,activo AS active FROM farmetrica.proveedores_unificados WHERE cliente_slug=$1 AND id=$2 AND activo",
  [slug,id]);
 return rows[0]||null;
}
async function categories(pool,slug){
 const {rows}=await pool.query(
  "SELECT id::text,nombre AS name,activo AS active FROM farmetrica.proveedor_documento_categorias WHERE cliente_slug=$1 ORDER BY nombre",
  [slug]);
 return rows;
}
async function contacts(pool,slug,id){
 const {rows}=await pool.query(
  "SELECT id::text,nombre AS name,apellidos AS surname,cargo AS position,email,telefono AS phone,notas AS notes,principal AS \"primary\",creado_en AS createdAt FROM farmetrica.proveedor_contactos WHERE cliente_slug=$1 AND proveedor_id=$2 ORDER BY principal DESC,nombre,apellidos",
  [slug,id]);
 return rows;
}
async function documents(pool,slug,id){
 const {rows}=await pool.query(
  "SELECT d.id::text,d.categoria_id::text AS \"categoryId\",c.nombre AS category,d.nombre AS name,d.nombre_archivo AS \"fileName\",d.tipo_mime AS mime,d.version,d.fecha_documento AS \"documentDate\",d.notas AS notes,d.tamano AS size,d.creado_en AS \"createdAt\" FROM farmetrica.proveedor_documentos d JOIN farmetrica.proveedor_documento_categorias c ON c.cliente_slug=d.cliente_slug AND c.id=d.categoria_id WHERE d.cliente_slug=$1 AND d.proveedor_id=$2 ORDER BY d.creado_en DESC",
  [slug,id]);return rows;
}
async function erpInfo(pool,ctx,id){
 // Datos de origen solo lectura, sin sustituir cambios guardados en Farmétrica.
 const schema=ctx.client.schema;
 if(!/^[a-z][a-z0-9_]{1,62}$/.test(schema))return [];
 try{
  const {rows}=await pool.query({text:
   'SELECT to_jsonb(p) AS record FROM farmetrica.proveedores_unificados_alias a JOIN "'+schema+'".proveedores p ON upper(btrim(p.farmacia_codigo::text))=upper(btrim(a.farmacia_codigo)) AND btrim(p.origen_id::text)=btrim(a.codigo_origen) WHERE a.cliente_slug=$1 AND a.proveedor_id=$2 LIMIT 12',
   values:[ctx.client.slug,id],query_timeout:4500});
  return rows.map(x=>x.record);
 }catch(e){
  // Si el ERP no tiene la tabla de detalle, la ficha canónica sigue disponible.
  if(["42P01","42703"].includes(e.code))return [];
  throw e;
 }
}
function readErp(erp){
 const first=erp[0]||{};
 const lower=Object.fromEntries(Object.entries(first).map(([k,v])=>[k.toLowerCase(),v]));
 const value=(...keys)=>keys.map(x=>lower[x.toLowerCase()]).find(x=>x!==null&&x!==undefined&&String(x).trim())||"";
 return {fiscalId:value("cif","nif","nif_cif","identificacion_fiscal","codigo_fiscal"),
  phone:value("telefono","telefono1","teléfono","movil"),
  email:value("email","correo","correo_electronico"),
  address:value("direccion","domicilio","direccion1"),
  website:value("web","pagina_web"),
  notes:""};
}
export function setupSupplierWorkspace(app,pool,{requireTenant}){
 const read=[...requireTenant()],write=[...requireTenant(),writeGuard];
 app.get(categoryRoot,...read,jsonRoute(async(req,res)=>{
  res.json(await categories(pool,req.context.client.slug));
 }));
 app.post(categoryRoot,...write,jsonRoute(async(req,res)=>{
  const name=norm(req.body?.name,80);
  if(name.length<2||name.length>80)return fail(res,"Nombre de categoría inválido");
  const slug=req.context.client.slug;
  const {rows}=await pool.query(
   "INSERT INTO farmetrica.proveedor_documento_categorias(cliente_slug,nombre) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING id::text,nombre AS name,activo AS active",[slug,name]);
  if(!rows.length)return fail(res,"La categoría ya existe",409);
  res.status(201).json(rows[0]);
 }));
 app.put(categoryRoot+"/:categoryId",...write,jsonRoute(async(req,res)=>{
  const id=req.params.categoryId,name=norm(req.body?.name,80),active=req.body?.active;
  if(!validId(id)||name.length<2||name.length>80||typeof active!=="boolean")
   return fail(res,"Datos de categoría inválidos");
  const {rows}=await pool.query(
   "UPDATE farmetrica.proveedor_documento_categorias SET nombre=$3,activo=$4 WHERE cliente_slug=$1 AND id=$2 AND NOT EXISTS (SELECT 1 FROM farmetrica.proveedor_documento_categorias c WHERE c.cliente_slug=$1 AND c.id<>$2 AND lower(btrim(c.nombre))=lower(btrim($3))) RETURNING id::text,nombre AS name,activo AS active",
   [req.context.client.slug,id,name,active]);
  if(!rows.length)return fail(res,"Categoría inexistente o nombre duplicado",409);
  res.json(rows[0]);
 }));
 app.get(supplierRoot+"/:id/ficha",...read,jsonRoute(async(req,res)=>{
  const slug=req.context.client.slug,id=req.params.id;
  const s=await supplier(pool,slug,id);
  if(!s)return fail(res,"Proveedor no encontrado",404);
  const [cat,ct,docs,profile,erp]=await Promise.all([
   categories(pool,slug),contacts(pool,slug,id),documents(pool,slug,id),
   pool.query("SELECT datos FROM farmetrica.proveedor_fichas WHERE cliente_slug=$1 AND proveedor_id=$2",[slug,id]),
   erpInfo(pool,req.context,id)]);
  res.json({supplier:s,categories:cat,contacts:ct,documents:docs,
   erp:readErp(erp),erpRecords:erp.map(x=>({pharmacyCode:x.farmacia_codigo||"",sourceCode:x.origen_id||"",name:x.nombre||""})),
   profile:profile.rows[0]?.datos||{},canManage:canManage(req)});
 }));
 app.put(supplierRoot+"/:id/ficha",...write,jsonRoute(async(req,res)=>{
  const slug=req.context.client.slug,id=req.params.id;
  const name=norm(req.body?.name,200),data={};
  if(!validId(id)||name.length<2||name.length>200)return fail(res,"Nombre de proveedor inválido");
  for(const field of fields){
   const v=norm(req.body?.[field],field==="notes"?2000:300);
   if(v.length>(field==="notes"?2000:300))return fail(res,"Campo demasiado largo: "+field);
   data[field]=v;
  }
  if(data.email&&(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)||data.email.length>254))
   return fail(res,"Correo electrónico inválido");
  const db=await pool.connect();
  try{
   await db.query("BEGIN");
   const update=await db.query(
    "UPDATE farmetrica.proveedores_unificados SET nombre=$3,actualizado_en=now() WHERE cliente_slug=$1 AND id=$2 AND activo RETURNING id",
    [slug,id,name]);
   if(!update.rowCount){await db.query("ROLLBACK");return fail(res,"Proveedor no encontrado",404)}
   await db.query("INSERT INTO farmetrica.proveedor_fichas(cliente_slug,proveedor_id,datos) VALUES($1,$2,$3::jsonb) ON CONFLICT(cliente_slug,proveedor_id) DO UPDATE SET datos=EXCLUDED.datos,actualizado_en=now()",
    [slug,id,JSON.stringify(data)]);
   await db.query("COMMIT");res.json({saved:true});
  }catch(e){await db.query("ROLLBACK").catch(()=>{});throw e}finally{db.release()}
 }));
 function checkContact(req,res){
  const body=req.body||{},data={
   name:norm(body.name,100),surname:norm(body.surname,120),
   position:norm(body.position,140),email:norm(body.email,254),
   phone:norm(body.phone,100),notes:norm(body.notes,2000),primary:body.primary===true};
  if(!data.name||Object.values(data).some(x=>typeof x==="string"&&x.length>2000)||
   data.name.length>100||data.surname.length>120||data.position.length>140||
   data.email.length>254||data.phone.length>100||data.notes.length>2000||
   data.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)){
    fail(res,"Datos de contacto inválidos");return null;
  }
  return data;
 }
 async function storeContact(req,res,isUpdate){
  const slug=req.context.client.slug,id=req.params.id,data=checkContact(req,res);
  if(!data)return;
  if(!await supplier(pool,slug,id))return fail(res,"Proveedor no encontrado",404);
  const contactId=req.params.contactId;
  if(isUpdate&&!validId(contactId))return fail(res,"Contacto inválido");
  const db=await pool.connect();
  try{
   await db.query("BEGIN");
   // Evitar dos contactos principales concurrentes para el mismo proveedor.
   await db.query("SELECT id FROM farmetrica.proveedores_unificados WHERE cliente_slug=$1 AND id=$2 FOR UPDATE",[slug,id]);
   if(data.primary)await db.query(
    "UPDATE farmetrica.proveedor_contactos SET principal=false WHERE cliente_slug=$1 AND proveedor_id=$2 AND principal",
    [slug,id]);
   const query=isUpdate?
    "UPDATE farmetrica.proveedor_contactos SET nombre=$4,apellidos=$5,cargo=$6,email=$7,telefono=$8,notas=$9,principal=$10,actualizado_en=now() WHERE cliente_slug=$1 AND proveedor_id=$2 AND id=$3 RETURNING id::text":
    "INSERT INTO farmetrica.proveedor_contactos(cliente_slug,proveedor_id,nombre,apellidos,cargo,email,telefono,notas,principal) VALUES($1,$2,$4,$5,$6,$7,$8,$9,$10) RETURNING id::text";
   const {rows}=await db.query(query,[slug,id,contactId||null,data.name,data.surname,data.position,data.email,data.phone,data.notes,data.primary]);
   if(!rows.length){await db.query("ROLLBACK");return fail(res,"Contacto no encontrado",404)}
   await db.query("COMMIT");res.status(isUpdate?200:201).json({id:rows[0].id,saved:true});
  }catch(e){await db.query("ROLLBACK").catch(()=>{});throw e}finally{db.release()}
 }
 app.post(supplierRoot+"/:id/contactos",...write,jsonRoute((req,res)=>storeContact(req,res,false)));
 app.put(supplierRoot+"/:id/contactos/:contactId",...write,jsonRoute((req,res)=>storeContact(req,res,true)));
 app.delete(supplierRoot+"/:id/contactos/:contactId",...write,jsonRoute(async(req,res)=>{
  const {id,contactId}=req.params;
  if(!validId(id)||!validId(contactId))return fail(res,"Contacto inválido");
  const {rowCount}=await pool.query(
   "DELETE FROM farmetrica.proveedor_contactos WHERE cliente_slug=$1 AND proveedor_id=$2 AND id=$3",
   [req.context.client.slug,id,contactId]);
  if(!rowCount)return fail(res,"Contacto no encontrado",404);
  res.json({deleted:true});
 }));
 app.post(supplierRoot+"/:id/documentos",...write,
  express.raw({type:"application/octet-stream",limit:"15mb"}),jsonRoute(async(req,res)=>{
   const slug=req.context.client.slug,id=req.params.id;
   const name=norm(cleanHeader(req.get("x-document-name")),200),
    fileName=norm(cleanHeader(req.get("x-file-name")),220),
    categoryId=String(req.get("x-category-id")||""),
    date=String(req.get("x-document-date")||"").trim(),
    version=norm(cleanHeader(req.get("x-document-version")),80),
    notes=norm(cleanHeader(req.get("x-document-notes")),1000),
    mime=String(req.get("x-file-type")||"application/octet-stream").toLowerCase();
   const bytes=req.body;
   if(!validId(id)||!validId(categoryId)||!name||name.length>200||!fileName||
    fileName.length>220||version.length>80||notes.length>1000||
    !validDay(date)||!mimeTypes.has(mime)||!Buffer.isBuffer(bytes)||
    bytes.length<1||bytes.length>15728640)return fail(res,"Revisa el documento (máximo 15 MB)");
   if(!await supplier(pool,slug,id))return fail(res,"Proveedor no encontrado",404);
   const {rows:cat}=await pool.query(
    "SELECT id FROM farmetrica.proveedor_documento_categorias WHERE cliente_slug=$1 AND id=$2 AND activo",
    [slug,categoryId]);
   if(!cat.length)return fail(res,"Selecciona una categoría activa");
   const {rows}=await pool.query(
    "INSERT INTO farmetrica.proveedor_documentos(cliente_slug,proveedor_id,categoria_id,nombre,nombre_archivo,tipo_mime,version,fecha_documento,notas,archivo,tamano) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id::text",
    [slug,id,categoryId,name,fileName,mime,version,date||null,notes,bytes,bytes.length]);
   res.status(201).json({id:rows[0].id,saved:true});
  }));
 app.put(supplierRoot+"/:id/documentos/:documentId",...write,jsonRoute(async(req,res)=>{
  const slug=req.context.client.slug,{id,documentId}=req.params;
  const name=norm(req.body?.name,200),categoryId=String(req.body?.categoryId||""),
   date=String(req.body?.documentDate||""),version=norm(req.body?.version,80),
   notes=norm(req.body?.notes,1000);
  if(!validId(id)||!validId(documentId)||!validId(categoryId)||!name||
   name.length>200||version.length>80||notes.length>1000||!validDay(date))
   return fail(res,"Metadatos de documento inválidos");
  const {rowCount}=await pool.query(
   "UPDATE farmetrica.proveedor_documentos SET nombre=$4,categoria_id=$5,fecha_documento=$6,version=$7,notas=$8,actualizado_en=now() WHERE cliente_slug=$1 AND proveedor_id=$2 AND id=$3 AND EXISTS(SELECT 1 FROM farmetrica.proveedor_documento_categorias c WHERE c.cliente_slug=$1 AND c.id=$5 AND c.activo)",
   [slug,id,documentId,name,categoryId,date||null,version,notes]);
  if(!rowCount)return fail(res,"Documento o categoría no encontrados",404);
  res.json({saved:true});
 }));
 app.get(supplierRoot+"/:id/documentos/:documentId/descargar",...read,jsonRoute(async(req,res)=>{
  const {id,documentId}=req.params;
  if(!validId(id)||!validId(documentId))return fail(res,"Documento inválido");
  const {rows}=await pool.query(
   "SELECT nombre_archivo,archivo,tamano FROM farmetrica.proveedor_documentos WHERE cliente_slug=$1 AND proveedor_id=$2 AND id=$3",
   [req.context.client.slug,id,documentId]);
  if(!rows.length)return fail(res,"Documento no encontrado",404);
  const file=rows[0];
  res.set("Content-Type","application/octet-stream");
  res.set("X-Content-Type-Options","nosniff");
  res.set("Content-Disposition","attachment; filename*=UTF-8''"+encodeURIComponent(file.nombre_archivo));
  res.set("Content-Length",String(file.tamano));res.end(file.archivo);
 }));
 app.delete(supplierRoot+"/:id/documentos/:documentId",...write,jsonRoute(async(req,res)=>{
  const {id,documentId}=req.params;
  if(!validId(id)||!validId(documentId))return fail(res,"Documento inválido");
  const {rowCount}=await pool.query(
   "DELETE FROM farmetrica.proveedor_documentos WHERE cliente_slug=$1 AND proveedor_id=$2 AND id=$3",
   [req.context.client.slug,id,documentId]);
  if(!rowCount)return fail(res,"Documento no encontrado",404);
  res.json({deleted:true});
 }));
}
