import {readFile} from "node:fs/promises";
import {readLaboratoryArticles,normalizeLaboratoryKey,selectedPharmacies} from "./laboratoryCatalog.js";
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
import {readDirectLaboratoryCatalog} from "./laboratoryFastCatalog.js";
import {readUnifiedLaboratoryCatalog} from "./laboratoryUnionCatalog.js";
import {readLaboratoryOrderFrequency} from "./laboratoryOrderSettings.js";
import {hasNativeNormalizedCN} from "./articleSchemaCache.js";
const SQL=await readFile(new URL("./laboratoryOrderMetrics.sql",import.meta.url),"utf8");
const SCHEMA=/^[a-z][a-z0-9_]{1,62}$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
export function cnCategory(cn){
 const c=String(cn??"").trim();
 if(!/^\d{6,7}$/.test(c))return null;
 return Number(c.slice(0,6))<400000?"parafarmacia":"medicacion";
}
export const isOrderQuantity=value=>typeof value==="number"&&Number.isSafeInteger(value)&&value>=0&&value<=999999;
export function validPlannerDate(date){
 if(!DATE.test(String(date)))return false;
 const parsed=new Date(date+"T00:00:00Z");
 return !Number.isNaN(parsed.getTime())&&parsed.toISOString().slice(0,10)===date;
}
export const pharmacyScope=ids=>[...new Set(ids.map(Number))].sort((a,b)=>a-b).join(",");

export async function readLaboratoryOrderMatrix(pool,ctx,options){
 const [base,frequencyDays]=await Promise.all([
  options.prefetchedRows?
   Promise.resolve({rows:options.prefetchedRows,total:options.prefetchedRows.length,
    page:1,size:options.prefetchedRows.length}):
   readDirectLaboratoryCatalog(pool,ctx,options),
  readLaboratoryOrderFrequency(pool,ctx.client.slug,options.key)
 ]);
 const warning=null;
 const fallback={...base,from:options.from,to:options.to,frequencyDays,
  rows:base.rows.map(r=>({...r,byPharmacy:{},totalSold:null,totalSuggested:null})),metricsUnavailable:true};
 const selected=base.rows.map(row=>({reference:row.referencia,cn:row.cn}));
 if(!selected.length)return {...fallback,warning};
 if(!options.pharmacies.length)
  return {...fallback,warning:"No hay farmacias asignadas o seleccionadas. Se muestran referencias, pero no stock ni ventas."};
 if(!SCHEMA.test(ctx.client.schema))throw Error("Esquema no autorizado");
 // La columna nativa cn_normalizado existe en Farmatic recientes y evita
 // transformar cada fila a JSON en las búsquedas de stock y ventas.
 const nativeCN=await hasNativeNormalizedCN(pool,ctx.client.schema).catch(()=>false);
 const sql=SQL.replaceAll("__SCHEMA__",'"'+ctx.client.schema+'"')
  .replaceAll("__FARMACIA_CODE__",pharmacyDataCodeSQL("f"))
  .replaceAll("__CN_NORMALIZED__",nativeCN?"a.cn_normalizado":"to_jsonb(a)->>'cn_normalizado'");
 let rows;
 const started=Date.now();
 try{
  const result=await pool.query({text:sql,
   values:[JSON.stringify(selected),options.pharmacies,ctx.client.slug,options.from,options.to],
   query_timeout:30000});
  rows=result.rows;
  if(selected.length>=100)console.info("PREPARADOR_METRICAS",JSON.stringify({
   references:selected.length,pharmacies:options.pharmacies.length,
   elapsedMs:Date.now()-started,status:"ok"
  }));
 }catch(e){
  // El motivo concreto de pasar a lotes se registra para diagnosticar
  // índices y timeouts; nunca se registran CN, ventas ni identificadores.
  console.warn("PREPARADOR_METRICAS",JSON.stringify({
   references:selected.length,pharmacies:options.pharmacies.length,
   elapsedMs:Date.now()-started,status:"fallback",
   code:e.code||e.name||"QUERY_ERROR"
  }));
  return {...fallback,metricsErrorCode:e.code||"QUERY_ERROR",
   warning:"Se han recuperado los artículos, pero no sus métricas de stock y ventas. "+(e.code||"Error de consulta")};
 }
 const byRef=new Map();
 for(const row of rows){
  if(!byRef.has(row.reference))byRef.set(row.reference,{});
  byRef.get(row.reference)[String(row.pharmacyId)]={
   pharmacyId:String(row.pharmacyId),stock:row.stock===null?null:Number(row.stock),
   stockAt:row.stockAt,unitsPeriod:Number(row.unitsPeriod||0),
   units3:Number(row.units3||0),units12:Number(row.units12||0),
   ordered:Number(row.ordered||0),suggested:row.suggested===null?null:Number(row.suggested)
  };
 }
 return {...base,from:options.from,to:options.to,frequencyDays,warning,metricsUnavailable:false,
  rows:base.rows.map(row=>{
   const byPharmacy=byRef.get(row.referencia)||{};
   return {...row,byPharmacy,
    totalSold:Object.values(byPharmacy).reduce((sum,m)=>sum+m.unitsPeriod,0),
    totalSuggested:Object.values(byPharmacy).some(m=>m.suggested===null)?null:
     Object.values(byPharmacy).reduce((sum,m)=>sum+m.suggested,0)};
  })
 };
}

export function normalizeDraftItems(items,type,pharmacies){
 if(!Array.isArray(items)||items.length>5000)return null;
 const allowed=new Set(pharmacies.map(String)),seen=new Set();
 const output=[];
 for(const row of items){
  if(!row||typeof row.reference!=="string"||row.reference.length>120||
   !(/^(?:[0-9]{6,7}|[0-9]{13})$/.test(row.reference)||/^ERP:\d+:[A-Za-z0-9._:-]{1,90}$/.test(row.reference))||
   typeof row.name!=="string"||row.name.length>240||
   (row.cn!==null&&row.cn!==undefined&&!/^\d{6,7}$/.test(row.cn))||
   (row.cn&&cnCategory(row.cn)!==null&&cnCategory(row.cn)!==type)||seen.has(row.reference))return null;
  seen.add(row.reference);
  const metrics={};
  if(row.metrics!==undefined){
   if(!row.metrics||typeof row.metrics!=="object"||Array.isArray(row.metrics)||
    Object.keys(row.metrics).some(id=>!allowed.has(id)))return null;
   for(const [id,m] of Object.entries(row.metrics)){
    if(!m||typeof m!=="object"||Array.isArray(m)||
      ["stock","units3","units12","unitsPeriod","suggested"].some(k=>
       m[k]!=null&&(!Number.isFinite(m[k])||Math.abs(m[k])>1e9)))return null;
    metrics[id]={stock:m.stock??null,units3:m.units3??0,units12:m.units12??0,
     unitsPeriod:m.unitsPeriod??0,suggested:m.suggested??null};
   }
  }
  if(type==="parafarmacia"){
   if(!isOrderQuantity(row.units))return null;
   output.push({reference:row.reference,cn:row.cn||null,name:row.name,units:row.units,metrics});
  }else{
   if(!row.unitsByPharmacy||typeof row.unitsByPharmacy!=="object"||
    Array.isArray(row.unitsByPharmacy))return null;
   const units={};
   for(const [id,count] of Object.entries(row.unitsByPharmacy)){
    if(!allowed.has(String(id))||!isOrderQuantity(count))return null;
    units[String(id)]=count;
   }
   output.push({reference:row.reference,cn:row.cn||null,name:row.name,unitsByPharmacy:units,metrics});
  }
 }
 return output;
}

export function setupLaboratoryOrderPlanner(app,pool,{requireTenant}){
 const guard=requireTenant(),enabled=req=>req.context.role==="superadministrador"||req.context.modules?.compras===true;
 const parse=req=>{
  const data=req.method==="GET"?req.query:req.body;
  const laboratory=normalizeLaboratoryKey(data?.laboratorio);
  const raw=data?.farmacias;
  const pharmacies=Array.isArray(raw)?raw.map(Number):selectedPharmacies(req.context,raw);
  const allowed=new Set((req.context.pharmacies||[]).map(p=>Number(p.id)));
  if(!laboratory||!pharmacies||pharmacies.length>100||
   pharmacies.some(id=>!Number.isSafeInteger(id)||!allowed.has(id)))return null;
  return {laboratory,pharmacies:[...new Set(pharmacies)]};
 };
 // Catálogo completo: unión de CN oficiales con compras de todos los
 // proveedores de Farmatic vinculados al mismo laboratorio en el maestro.
 // Sin paginación intermedia ni ventas históricas en esta primera fase.
 if(typeof app.get==="function")app.get("/api/analytics/pedidos/catalogo-unificado",...guard,async(req,res,next)=>{
  if(!enabled(req))return res.status(403).json({error:"Compras no habilitado"});
  const common=parse(req),type=String(req.query.tipo||"");
  const search=String(req.query.buscar||"").trim();
  if(!common||!["medicacion","parafarmacia"].includes(type)||
   search.length>100||!SCHEMA.test(req.context.client.schema))
   return res.status(400).json({error:"Laboratorio o farmacias no válidos"});
  try{
   res.json(await readUnifiedLaboratoryCatalog(pool,req.context,{
    key:common.laboratory,pharmacies:common.pharmacies,type,search
   }));
  }catch(e){
   if(["57014","53300","TOO_MANY"].includes(e.code)||/timeout/i.test(e.message||""))
    return res.status(504).json({error:"El catálogo unificado tardó demasiado. Se utilizará la carga progresiva."});
   next(e);
  }
 });
 // El IN de productos se materializa UNA VEZ como tabla refs y todas las
 // ventas de 3/12 meses y del período se agregan en una única sentencia SQL.
 if(typeof app.post==="function")app.post("/api/analytics/pedidos/matriz-conjunta",...guard,async(req,res,next)=>{
  if(!enabled(req))return res.status(403).json({error:"Compras no habilitado"});
  const common=parse(req),type=String(req.body?.tipo||""),
   from=String(req.body?.desde||""),to=String(req.body?.hasta||"");
  const provided=req.body?.referencias;
  if(!common||!["medicacion","parafarmacia"].includes(type)||
   !validPlannerDate(from)||!validPlannerDate(to)||from>to||
   Date.parse(to)-Date.parse(from)>5*366*86400000||
   !Array.isArray(provided)||!provided.length||provided.length>5000||
   !SCHEMA.test(req.context.client.schema))
   return res.status(400).json({error:"Período o referencias no válidos"});
  const seen=new Set(),rows=[];
  for(const r of provided){
   const reference=r?.referencia,cn=r?.cn;
   if(typeof reference!=="string"||reference.length>120||
    !(/^[0-9]{6,7}$/.test(reference)||
     (type==="parafarmacia"&&/^ERP:\d+:[A-Za-z0-9._:-]{1,90}$/.test(reference)))||
    !(cn===null||cn===undefined||/^[0-9]{6,7}$/.test(cn))||
    (cn&&cnCategory(cn)!==type)||seen.has(reference))
    return res.status(400).json({error:"Hay códigos duplicados o inválidos"});
   seen.add(reference);
   rows.push({referencia:reference,cn:cn||null,
    nombre:typeof r.nombre==="string"?r.nombre.slice(0,240):reference});
  }
  try{
   res.json(await readLaboratoryOrderMatrix(pool,req.context,{
    key:common.laboratory,pharmacies:common.pharmacies,type,from,to,
    prefetchedRows:rows
   }));
  }catch(e){
   if(["57014","53300"].includes(e.code)||/timeout/i.test(e.message||""))
    return res.status(504).json({error:"Las métricas agregadas han tardado demasiado. Se utilizarán lotes pequeños."});
   next(e);
  }
 });
 if(typeof app.get==="function")app.get("/api/analytics/pedidos/matriz-laboratorio",...guard,async(req,res,next)=>{
  if(!enabled(req))return res.status(403).json({error:"Compras no habilitado"});
  const common=parse(req),type=String(req.query.tipo||"");
  const from=String(req.query.desde||""),to=String(req.query.hasta||"");
  const search=String(req.query.buscar||"").trim();
  const page=Number(req.query.pagina||1),size=Number(req.query.tamano||40);
  if(!common||!["medicacion","parafarmacia"].includes(type)||
   !validPlannerDate(from)||!validPlannerDate(to)||from>to||
   (Date.parse(to)-Date.parse(from))>5*366*86400000||
   !Number.isSafeInteger(page)||page<1||page>100000||
   !Number.isSafeInteger(size)||size<1||size>100||search.length>100||
   !SCHEMA.test(req.context.client.schema))
    return res.status(400).json({error:"Revisa laboratorio, farmacias y fechas"});
  try{res.json(await readLaboratoryOrderMatrix(pool,req.context,{
    key:common.laboratory,pharmacies:common.pharmacies,type,from,to,search,page,size
   }));}catch(e){
    if(["57014","53300"].includes(e.code))
     return res.status(504).json({error:"La consulta ha tardado demasiado. Reduce el período o las farmacias."});
    next(e);
   }
 });
 // La interfaz ya recibió las referencias del catálogo. Calcular métricas
 // sobre esos CN exactos evita reconstruir otra vez el catálogo 25 veces.
 // El acceso sigue limitado al tenant y a las farmacias autorizadas.
 if(typeof app.post==="function")app.post("/api/analytics/pedidos/matriz-referencias",...guard,async(req,res,next)=>{
  if(!enabled(req))return res.status(403).json({error:"Compras no habilitado"});
  const common=parse(req),type=String(req.body?.tipo||"");
  const from=String(req.body?.desde||""),to=String(req.body?.hasta||"");
  const provided=req.body?.referencias;
  if(!common||!["medicacion","parafarmacia"].includes(type)||
   !validPlannerDate(from)||!validPlannerDate(to)||from>to||
   Date.parse(to)-Date.parse(from)>5*366*86400000||
   !Array.isArray(provided)||!provided.length||provided.length>250||
   !SCHEMA.test(req.context.client.schema))
   return res.status(400).json({error:"Referencias, farmacias o período inválidos"});
  const seen=new Set(),rows=[];
  for(const entry of provided){
   const reference=entry?.referencia,cn=entry?.cn;
   if(typeof reference!=="string"||reference.length>120||
    !(/^[0-9]{6,7}$/.test(reference)||
      (type==="parafarmacia"&&/^ERP:\d+:[A-Za-z0-9._:-]{1,90}$/.test(reference)))||
    !(cn===null||cn===undefined||/^[0-9]{6,7}$/.test(cn))||
    (cn&&cnCategory(cn)!==type)||seen.has(reference))
    return res.status(400).json({error:"Hay referencias duplicadas o no válidas"});
   seen.add(reference);
   rows.push({referencia:reference,cn:cn||null,nombre:typeof entry.nombre==="string"?
    entry.nombre.slice(0,240):reference});
  }
  try{
   res.json(await readLaboratoryOrderMatrix(pool,req.context,{
    key:common.laboratory,pharmacies:common.pharmacies,type,from,to,prefetchedRows:rows
   }));
  }catch(e){
   if(["57014","53300"].includes(e.code))
    return res.status(504).json({error:"El cálculo de ventas y stock ha tardado demasiado."});
   next(e);
  }
 });
 if(typeof app.get==="function")app.get("/api/analytics/pedidos/borrador-laboratorio",...guard,async(req,res,next)=>{
  if(!enabled(req))return res.status(403).json({error:"Compras no habilitado"});
  const common=parse(req),type=String(req.query.tipo||"");
  if(!common||!["medicacion","parafarmacia"].includes(type))
   return res.status(400).json({error:"Borrador inválido"});
  try{
   const {rows}=await pool.query(
    'SELECT desde::text,hasta::text,lineas,actualizado_en AS "updatedAt" FROM farmetrica.pedidos_laboratorio_borradores WHERE cliente_slug=$1 AND laboratorio_clave=$2 AND tipo=$3 AND farmacias_clave=$4',
    [req.context.client.slug,common.laboratory,type,pharmacyScope(common.pharmacies)]);
   res.json(rows[0]||{lineas:[]});
  }catch(e){next(e);}
 });
 if(typeof app.put==="function")app.put("/api/analytics/pedidos/borrador-laboratorio",...guard,async(req,res,next)=>{
  if(!enabled(req)||!["administrador","gestor","superadministrador"].includes(req.context.role))
   return res.status(403).json({error:"No tienes permiso para guardar pedidos"});
  const common=parse(req),type=String(req.body?.tipo||""),
   from=String(req.body?.desde||""),to=String(req.body?.hasta||"");
  const items=normalizeDraftItems(req.body?.lineas,type,common?.pharmacies||[]);
  if(!common||!common.pharmacies.length||!["medicacion","parafarmacia"].includes(type)||
   !validPlannerDate(from)||!validPlannerDate(to)||from>to||items===null)
   return res.status(400).json({error:"No se pueden guardar cantidades o fechas inválidas"});
  try{
   const {rows}=await pool.query(
    "INSERT INTO farmetrica.pedidos_laboratorio_borradores (cliente_slug,laboratorio_clave,tipo,farmacias_clave,desde,hasta,lineas) VALUES ($1,$2,$3,$4,$5::date,$6::date,$7::jsonb) ON CONFLICT(cliente_slug,laboratorio_clave,tipo,farmacias_clave) DO UPDATE SET desde=EXCLUDED.desde,hasta=EXCLUDED.hasta,lineas=EXCLUDED.lineas,actualizado_en=now() RETURNING actualizado_en AS \"updatedAt\"",
    [req.context.client.slug,common.laboratory,type,pharmacyScope(common.pharmacies),
     from,to,JSON.stringify(items)]);
   res.json({saved:true,count:items.length,updatedAt:rows[0]?.updatedAt});
  }catch(e){next(e);}
 });
}
