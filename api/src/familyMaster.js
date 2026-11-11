// Maestro de familias: reconciliación por IdArticu/CN entre Farmatic de referencia
// y códigos locales, sin alterar ningún maestro ni artículo sincronizado del ERP.
import {randomUUID} from "node:crypto";
import {familyKey,referenceKey,cleanFamilyName,selectFamilyDestination,familyNameSlug,selectNamedDestination} from "./familyMatching.js";

const validId=x=>/^[1-9]\d*$/.test(String(x||""));
const validCode=x=>typeof x==="string"&&x.trim().length>0&&x.trim().length<=120;
const Q=schema=>'"'+schema+'"';
const SCHEMA=/^[a-z][a-z0-9_]{1,62}$/;

function refPharmacies(ctx){
 const sites=ctx.establishments||ctx.pharmacies||[];
 // Solo Ampedia tiene esta correspondencia validada: no se infiere de los IDs
 // de otras empresas ni se supone que sus códigos signifiquen lo mismo.
 if(ctx.client.slug!=="ampedia")return {para:null,med:null};
 const code=p=>String(p.databaseCode||p.sourceCode||"").toUpperCase();
 return {para:"ALMACEN",
  med:code(sites.find(p=>code(p)==="ABA"||/abad[ií]a/i.test(p.name)))||"ABA"};
}
async function readSourceFamilies(db,schema,refs,slug){
 const q=Q(schema);
 const {rows:articleFamilies}=await db.query({
  text:"SELECT upper(btrim(farmacia_codigo)) AS pharmacy,btrim(familia) AS code,"+
   " count(*)::int AS articles,"+
   " count(*) FILTER(WHERE origen_id ~ '^[0-9]{6}$' AND"+
   " (CASE WHEN origen_id ~ '^[0-9]{6}$' THEN origen_id::int<400000 ELSE false END))::int AS para,"+
   " count(*) FILTER(WHERE origen_id ~ '^[0-9]{6}$' AND"+
   " (CASE WHEN origen_id ~ '^[0-9]{6}$' THEN origen_id::int>=400000 ELSE false END))::int AS med"+
   " FROM "+q+".articulos"+
   " WHERE nullif(btrim(familia),'') IS NOT NULL GROUP BY 1,2",
  query_timeout:90000});
 const map=new Map();
 for(const item of articleFamilies){
  const para=Number(item.para),med=Number(item.med);
  const segment=para>0&&med===0?"PARAFARMACIA":med>0&&para===0?"MEDICACION":"SIN_DETERMINAR";
  map.set(familyKey(item.pharmacy,item.code),
   {pharmacyCode:item.pharmacy,code:item.code,name:"",articles:Number(item.articles),segment});
 }
 // El sincronizador deposita el catálogo completo en farmetrica.familias.
 // En otros clientes solo se busca dentro de su propio esquema para no
 // atribuirles familias ajenas del ERP de Ampedia.
 const candidates=schema==="farmetrica"?[schema]:
  slug==="ampedia"?["farmetrica",schema]:[schema];
 let available=false;
 for(const candidate of candidates){
  const {rows:fields}=await db.query(
   "SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='familias'",
   [candidate]);
  if(!["farmacia_codigo","origen_id","nombre"].every(x=>fields.some(f=>f.column_name===x)))continue;
  available=true;
  const {rows:names}=await db.query({text:
   "SELECT upper(btrim(farmacia_codigo)) AS pharmacy,btrim(origen_id) AS code,"+
   " btrim(nombre) AS name FROM "+Q(candidate)+".familias"+
   " WHERE nullif(btrim(origen_id),'') IS NOT NULL",query_timeout:60000});
  for(const item of names){
   const k=familyKey(item.pharmacy,item.code);
   const old=map.get(k)||{pharmacyCode:item.pharmacy,code:item.code,articles:0,name:""};
   if(!old.name)old.name=String(item.name||"");
   map.set(k,old);
  }
 }
 const {rows:referenceRows}=refs.para&&refs.med?await db.query({text:
  "SELECT upper(btrim(farmacia_codigo)) AS pharmacy,btrim(familia) AS code,"+
  " count(*)::int AS articles FROM "+q+".articulos WHERE"+
  " nullif(btrim(familia),'') IS NOT NULL AND origen_id ~ '^[0-9]{6}$' AND"+
  " ((upper(btrim(farmacia_codigo))=$1 AND (CASE WHEN origen_id ~ '^[0-9]{6}$' THEN origen_id::int<400000 ELSE false END)) OR"+
  " (upper(btrim(farmacia_codigo))=$2 AND (CASE WHEN origen_id ~ '^[0-9]{6}$' THEN origen_id::int>=400000 ELSE false END)))"+
  " GROUP BY 1,2",values:[refs.para,refs.med],query_timeout:60000}):{rows:[]};
 const references=new Map();
 for(const r of referenceRows){
  const segment=r.pharmacy===refs.para?"PARAFARMACIA":"MEDICACION";
  references.set(familyKey(r.pharmacy,r.code),
   {key:referenceKey(segment,r.code),segment,count:Number(r.articles),
    pharmacy:r.pharmacy,code:r.code});
 }
 const {rows:evidence}=references.size?await db.query({text:
  "SELECT upper(btrim(a.farmacia_codigo)) AS pharmacy,btrim(a.familia) AS code,"+
  " upper(btrim(r.farmacia_codigo)) AS reference_pharmacy,btrim(r.familia) AS reference_code,"+
  " count(DISTINCT a.origen_id)::int AS articles"+
  " FROM "+q+".articulos a JOIN "+q+".articulos r ON r.origen_id=a.origen_id"+
  " AND upper(btrim(r.farmacia_codigo))=CASE WHEN a.origen_id ~ '^[0-9]{6}$' THEN CASE WHEN a.origen_id::int<400000 THEN $1 ELSE $2 END ELSE NULL END"+
  " WHERE a.origen_id ~ '^[0-9]{6}$'"+
  " AND nullif(btrim(a.familia),'') IS NOT NULL"+
  " AND nullif(btrim(r.familia),'') IS NOT NULL"+
  " GROUP BY 1,2,3,4",values:[refs.para,refs.med],query_timeout:120000}):{rows:[]};
 const votes=new Map();
 for(const v of evidence){
  const k=familyKey(v.pharmacy,v.code);
  if(!votes.has(k))votes.set(k,[]);
  votes.get(k).push({referencePharmacy:v.reference_pharmacy,referenceCode:v.reference_code,
   count:Number(v.articles)});
 }
 return {sources:[...map.values()],references,votes,namesAvailable:available};
}
function planMappings({sources,references,votes}){
 const groups=new Map(),origins=[];
 const sourceByKey=new Map(sources.map(s=>[familyKey(s.pharmacyCode,s.code),s]));
 const referenceNames=new Map(),sharedNames=new Map();
 for(const ref of references.values()){
  const source=sourceByKey.get(familyKey(ref.pharmacy,ref.code));
  groups.set(ref.key,{key:ref.key,name:cleanFamilyName(source?.name,ref.code),
   segment:ref.segment,referencePharmacy:ref.pharmacy,referenceCode:ref.code});
  const name=familyNameSlug(source?.name,ref.code);
  if(name){
   if(!referenceNames.has(name))referenceNames.set(name,new Set());
   referenceNames.get(name).add(ref.key);
  }
 }
 for(const source of sources){
  const name=familyNameSlug(source.name,source.code),segment=source.segment||"SIN_DETERMINAR";
  if(!name)continue;
  const key=name+"|"+segment;
  if(!sharedNames.has(key))sharedNames.set(key,new Set());
  sharedNames.get(key).add(source.pharmacyCode);
 }
 for(const source of sources){
  let decision=selectFamilyDestination(source,votes,references);
  if(decision.method==="sin_referencia")
   decision=selectNamedDestination(source,referenceNames,sharedNames,votes,references)||decision;
  if(!groups.has(decision.key)){
   groups.set(decision.key,{key:decision.key,name:cleanFamilyName(source.name,source.code),
    segment:source.segment||"SIN_DETERMINAR",referencePharmacy:null,referenceCode:null});
  }
  origins.push({key:decision.key,pharmacy:source.pharmacyCode,code:source.code,
   name:source.name||"",method:decision.method,
   matches:decision.matches,confidence:decision.confidence});
 }
 return {groups:[...groups.values()],origins};
}
async function linkArticles(db,schema,slug,refs){
 const q=Q(schema),run=randomUUID();
 const sourceCode="CASE WHEN a.origen_id ~ '^[0-9]{6}$'"+
  " THEN CASE WHEN a.origen_id::int<400000 THEN $3::text ELSE $4::text END ELSE NULL END";
 const sql="INSERT INTO farmetrica.familias_globales_articulos"+
  " (cliente_slug,farmacia_codigo,articulo_origen_id,familia_id,metodo,reconciliacion_id)"+
  " SELECT $1,upper(btrim(a.farmacia_codigo)),a.origen_id,"+
  " coalesce(ref_alias.familia_id,local_alias.familia_id),"+
  " CASE WHEN ref_alias.familia_id IS NOT NULL THEN 'referencia_cn' ELSE 'familia_local' END,$2"+
  " FROM "+q+".articulos a"+
  " LEFT JOIN "+q+".articulos r ON r.origen_id=a.origen_id"+
  " AND upper(btrim(r.farmacia_codigo))=("+sourceCode+")"+
  " LEFT JOIN farmetrica.familias_globales_alias ref_alias ON ref_alias.cliente_slug=$1"+
  " AND ref_alias.farmacia_codigo=upper(btrim(r.farmacia_codigo))"+
  " AND ref_alias.codigo_origen=btrim(r.familia)"+
  " LEFT JOIN farmetrica.familias_globales_alias local_alias ON local_alias.cliente_slug=$1"+
  " AND local_alias.farmacia_codigo=upper(btrim(a.farmacia_codigo))"+
  " AND local_alias.codigo_origen=btrim(a.familia)"+
  " WHERE coalesce(ref_alias.familia_id,local_alias.familia_id) IS NOT NULL"+
  " ON CONFLICT(cliente_slug,farmacia_codigo,articulo_origen_id) DO UPDATE SET"+
  " familia_id=EXCLUDED.familia_id,metodo=EXCLUDED.metodo,"+
  " reconciliacion_id=EXCLUDED.reconciliacion_id,actualizado_en=now()";
 const inserted=await db.query({text:sql,values:[slug,run,refs.para,refs.med],query_timeout:180000});
 const deleted=await db.query("DELETE FROM farmetrica.familias_globales_articulos"+
  " WHERE cliente_slug=$1 AND reconciliacion_id<>$2",[slug,run]);
 return {linked:inserted.rowCount,expired:deleted.rowCount};
}
export async function reconcileFamilies(pool,ctx){
 const schema=ctx.client.schema,slug=ctx.client.slug,refs=refPharmacies(ctx);
 if(!SCHEMA.test(schema))throw Error("Esquema no válido");
 const db=await pool.connect();
 try{
  await db.query("BEGIN");
  await db.query("SELECT pg_advisory_xact_lock(hashtext('familias:' || $1))",[slug]);
  const data=await readSourceFamilies(db,schema,refs,slug);
  const planned=planMappings(data);
  if(planned.groups.length){
   await db.query(
    "INSERT INTO farmetrica.familias_globales"+
    " (cliente_slug,clave,nombre,segmento,referencia_farmacia,referencia_codigo)"+
    " SELECT $1,j.key,j.name,j.segment,j.refph,j.refcode"+
    " FROM jsonb_to_recordset($2::jsonb) AS j("+
    " key text,name text,segment text,refph text,refcode text)"+
    " ON CONFLICT(cliente_slug,clave) DO UPDATE SET"+
    " nombre=CASE WHEN familias_globales.nombre_manual THEN familias_globales.nombre"+
    " ELSE EXCLUDED.nombre END, actualizado_en=now()",
    [slug,JSON.stringify(planned.groups.map(g=>({key:g.key,name:g.name,
     segment:g.segment,refph:g.referencePharmacy,refcode:g.referenceCode})))]);
   await db.query(
    "INSERT INTO farmetrica.familias_globales_alias"+
    " (cliente_slug,farmacia_codigo,codigo_origen,familia_id,nombre_origen,metodo,coincidencias,confianza)"+
    " SELECT $1,j.pharmacy,j.code,coalesce(g.fusionado_a,g.id),j.name,j.method,j.matches,j.confidence"+
    " FROM jsonb_to_recordset($2::jsonb) AS j("+
    " key text,pharmacy text,code text,name text,method text,matches int,confidence numeric)"+
    " JOIN farmetrica.familias_globales g ON g.cliente_slug=$1 AND g.clave=j.key"+
    " ON CONFLICT(cliente_slug,farmacia_codigo,codigo_origen) DO UPDATE SET"+
    " familia_id=CASE WHEN familias_globales_alias.metodo='manual'"+
    " THEN familias_globales_alias.familia_id ELSE EXCLUDED.familia_id END,"+
    " metodo=CASE WHEN familias_globales_alias.metodo='manual' THEN 'manual' ELSE EXCLUDED.metodo END,"+
    " coincidencias=EXCLUDED.coincidencias,confianza=EXCLUDED.confianza,"+
    " nombre_origen=EXCLUDED.nombre_origen,actualizado_en=now()",
    [slug,JSON.stringify(planned.origins)]);
  }
  const links=await linkArticles(db,schema,slug,refs);
  // La nueva conciliación puede sustituir una familia local provisional
  // por otra global; retirar únicamente los grupos vacíos no editados.
  await db.query(
   "UPDATE farmetrica.familias_globales g SET activo=false,actualizado_en=now()"+
   " WHERE g.cliente_slug=$1 AND (g.clave LIKE 'LOCAL:%' OR g.clave LIKE 'NAME:%')"+
   " AND NOT g.nombre_manual AND NOT EXISTS("+
   " SELECT 1 FROM farmetrica.familias_globales_alias a"+
   " WHERE a.cliente_slug=g.cliente_slug AND a.familia_id=g.id)"+
   " AND NOT EXISTS(SELECT 1 FROM farmetrica.familias_globales_articulos x"+
   " WHERE x.cliente_slug=g.cliente_slug AND x.familia_id=g.id)",[slug]);
  const {rows:counts}=await db.query(
   "SELECT metodo,count(*)::int AS n FROM farmetrica.familias_globales_alias"+
   " WHERE cliente_slug=$1 GROUP BY metodo",[slug]);
  const {rows:coverage}=await db.query({
   text:"SELECT count(*)::int AS all_articles,"+
    " count(l.familia_id)::int AS linked FROM "+Q(schema)+".articulos a"+
    " LEFT JOIN farmetrica.familias_globales_articulos l"+
    " ON l.cliente_slug=$1 AND l.farmacia_codigo=upper(btrim(a.farmacia_codigo))"+
    " AND l.articulo_origen_id=a.origen_id",values:[slug],query_timeout:60000});
  await db.query("COMMIT");
  return {families:planned.groups.length,localFamilies:planned.origins.length,
   namesAvailable:data.namesAvailable,references:data.references.size,
   methods:Object.fromEntries(counts.map(x=>[x.metodo,Number(x.n)])),
   linked:links.linked,totalArticles:Number(coverage[0]?.all_articles||0),
   unresolved:Number(coverage[0]?.all_articles||0)-Number(coverage[0]?.linked||0),
   referencePharmacies:refs};
 }catch(e){await db.query("ROLLBACK");throw e;}
 finally{db.release();}
}
export function setupFamilyMaster(app,pool,{requireTenantManager}){
 app.get("/api/tenant/familias-globales",...requireTenantManager(),async(req,res,next)=>{
  try{
   const {rows}=await pool.query(
    "SELECT g.id::text,g.clave AS key,g.nombre AS name,g.segmento AS segment,"+
    " g.referencia_farmacia AS \"referencePharmacy\",g.referencia_codigo AS \"referenceCode\","+
    " g.nombre_manual AS \"customName\",g.activo AS active,"+
    " coalesce((SELECT count(*)::int FROM farmetrica.familias_globales_articulos l"+
    " WHERE l.cliente_slug=g.cliente_slug AND l.familia_id=g.id),0) AS articles,"+
    " coalesce((SELECT json_agg(json_build_object("+
    " 'pharmacyCode',a.farmacia_codigo,'sourceCode',a.codigo_origen,"+
    " 'sourceName',a.nombre_origen,'method',a.metodo,"+
    " 'matches',a.coincidencias,'confidence',a.confianza)"+
    " ORDER BY a.farmacia_codigo,a.codigo_origen)"+
    " FROM farmetrica.familias_globales_alias a"+
    " WHERE a.cliente_slug=g.cliente_slug AND a.familia_id=g.id),'[]'::json) AS origins"+
    " FROM farmetrica.familias_globales g WHERE g.cliente_slug=$1 AND g.activo"+
    " ORDER BY g.segmento,g.nombre,g.id",[req.context.client.slug]);
   res.json({items:rows,referencePharmacies:refPharmacies(req.context)});
  }catch(e){next(e);}
 });
 app.post("/api/tenant/familias-globales/reconciliar",...requireTenantManager(),async(req,res,next)=>{
  try{res.json(await reconcileFamilies(pool,req.context));}catch(e){next(e);}
 });
 app.get("/api/tenant/familias-globales/:id/articulos",...requireTenantManager(),async(req,res,next)=>{
  const id=req.params.id,schema=req.context.client.schema;
  if(!validId(id)||!SCHEMA.test(schema))return res.status(400).json({error:"Familia incorrecta"});
  try{
   const {rows}=await pool.query({text:
    "SELECT l.farmacia_codigo AS \"pharmacyCode\",a.origen_id AS cn,"+
    " a.nombre AS name,a.familia AS \"sourceFamily\",l.metodo AS method"+
    " FROM farmetrica.familias_globales_articulos l"+
    " JOIN "+Q(schema)+".articulos a"+
    " ON upper(btrim(a.farmacia_codigo))=l.farmacia_codigo AND a.origen_id=l.articulo_origen_id"+
    " WHERE l.cliente_slug=$1 AND l.familia_id=$2"+
    " ORDER BY l.farmacia_codigo,a.origen_id LIMIT 50",
    values:[req.context.client.slug,id],query_timeout:15000});
   res.json({items:rows});
  }catch(e){next(e);}
 });
 app.put("/api/tenant/familias-globales/:id",...requireTenantManager(),async(req,res,next)=>{
  const name=String(req.body?.name||"").trim();
  if(!validId(req.params.id)||name.length<2||name.length>200)
   return res.status(400).json({error:"Nombre o familia incorrectos"});
  try{
   const {rows}=await pool.query(
    "UPDATE farmetrica.familias_globales SET nombre=$3,nombre_manual=true,actualizado_en=now()"+
    " WHERE cliente_slug=$1 AND id=$2 AND activo RETURNING id",
    [req.context.client.slug,req.params.id,name]);
   res.status(rows.length?200:404).json(rows.length?{ok:true}:{error:"Familia no encontrada"});
  }catch(e){next(e);}
 });
 app.put("/api/tenant/familias-globales/:id/origen",...requireTenantManager(),async(req,res,next)=>{
  const id=req.params.id,pharmacy=String(req.body?.pharmacyCode||"").trim().toUpperCase(),
   code=String(req.body?.sourceCode||"").trim(),schema=req.context.client.schema,slug=req.context.client.slug;
  if(!validId(id)||!validCode(pharmacy)||!validCode(code)||!SCHEMA.test(schema))
   return res.status(400).json({error:"Referencia de familia incorrecta"});
  const db=await pool.connect();
  try{
   await db.query("BEGIN");
   const target=await db.query(
    "SELECT id FROM farmetrica.familias_globales WHERE cliente_slug=$1 AND id=$2 AND activo FOR UPDATE",
    [slug,id]);
   if(!target.rowCount){await db.query("ROLLBACK");return res.status(404).json({error:"Familia de destino no encontrada"});}
   const changed=await db.query(
    "UPDATE farmetrica.familias_globales_alias SET familia_id=$4,metodo='manual',actualizado_en=now()"+
    " WHERE cliente_slug=$1 AND farmacia_codigo=$2 AND codigo_origen=$3 RETURNING farmacia_codigo",
    [slug,pharmacy,code,id]);
   if(!changed.rowCount){await db.query("ROLLBACK");return res.status(404).json({error:"Familia de origen no encontrada"});}
   await db.query(
    "UPDATE farmetrica.familias_globales_articulos l SET familia_id=$4,actualizado_en=now()"+
    " FROM "+Q(schema)+".articulos a"+
    " WHERE l.cliente_slug=$1 AND l.farmacia_codigo=$2 AND l.metodo='familia_local'"+
    " AND l.articulo_origen_id=a.origen_id AND upper(btrim(a.farmacia_codigo))=$2"+
    " AND btrim(a.familia)=$3",
    [slug,pharmacy,code,id]);
   await db.query("COMMIT");res.json({ok:true});
  }catch(e){await db.query("ROLLBACK");next(e);}finally{db.release();}
 });
 app.post("/api/tenant/familias-globales/fusionar",...requireTenantManager(),async(req,res,next)=>{
  const dest=String(req.body?.destination||"");
  const sources=[...new Set((Array.isArray(req.body?.sources)?req.body.sources:[]).map(String))];
  if(!validId(dest)||!sources.length||sources.length>100||sources.some(x=>!validId(x)||x===dest))
   return res.status(400).json({error:"Elige familias distintas y una familia de destino"});
  const slug=req.context.client.slug,db=await pool.connect();
  try{
   await db.query("BEGIN");
   const {rows}=await db.query(
    "SELECT id::text FROM farmetrica.familias_globales"+
    " WHERE cliente_slug=$1 AND id=ANY($2::bigint[]) AND activo FOR UPDATE",
    [slug,[dest,...sources]]);
   if(rows.length!==sources.length+1){await db.query("ROLLBACK");return res.status(409).json({error:"Las familias deben estar activas y pertenecer al cliente"});}
   await db.query(
    "UPDATE farmetrica.familias_globales_alias SET familia_id=$3,metodo='manual',actualizado_en=now()"+
    " WHERE cliente_slug=$1 AND familia_id=ANY($2::bigint[])",[slug,sources,dest]);
   await db.query(
    "UPDATE farmetrica.familias_globales_articulos SET familia_id=$3,actualizado_en=now()"+
    " WHERE cliente_slug=$1 AND familia_id=ANY($2::bigint[])",[slug,sources,dest]);
   await db.query(
    "UPDATE farmetrica.familias_globales SET activo=false,fusionado_a=$3,actualizado_en=now()"+
    " WHERE cliente_slug=$1 AND id=ANY($2::bigint[])",[slug,sources,dest]);
   await db.query("COMMIT");res.json({ok:true});
  }catch(e){await db.query("ROLLBACK");next(e);}finally{db.release();}
 });
}
