// Radiografía de Ventas: agregados mensuales persistentes, inmutables,
// por farmacia y dimensión. Los artículos se reclasifican en cada lectura con
// el maestro vigente, sin reescribir jamás la facturación histórica.
import {validSalesDateRange} from "./salesAnalysisPeriod.js";
import {mergeSalesFamilyRows} from "./salesOverview.js";
import {nameCommercialRows} from "./commercialNames.js";
import {summarizeSalesActivityRows} from "./salesActivity.js";

const IDENT=/^[a-z][a-z0-9_]{1,62}$/;
const keyOf=({slug,id,month})=>slug+"|"+id+"|"+month;
const numeric=v=>Number.isFinite(Number(v))?Number(v):0;
const nextMonth=month=>{
 const date=new Date(month.slice(0,7)+"-01T00:00:00Z");
 date.setUTCMonth(date.getUTCMonth()+1);
 return date.toISOString().slice(0,10);
};
const endOfMonth=month=>new Date(Date.parse(nextMonth(month)+"T00:00:00Z")-86400000)
 .toISOString().slice(0,10);

// La fecha de cierre procede de PostgreSQL y de la zona horaria farmacéutica.
export function panoramaPeriods(from,to,today){
 if(!validSalesDateRange(from,to)||from>today||to>today)return null;
 const closed=[],live=[],currentMonth=today.slice(0,7)+"-01";
 for(let month=from.slice(0,7)+"-01",n=0;month<=to.slice(0,7)+"-01";month=nextMonth(month),n++){
  if(n>300)return null;
  const start=from>month?from:month;
  const last=endOfMonth(month),finish=to<last?to:last;
  if(month<currentMonth&&start===month&&finish===last)closed.push(month);
  else live.push({from:start,to:finish});
 }
 return {closed,live};
}
export function buildSalesPanoramaGroupSQL(schema){
 if(!IDENT.test(schema))throw Error("Esquema de cliente no válido");
 const q='"'+schema+'"';
 return [
  "SELECT v.farmacia_codigo AS code,",
  " CASE WHEN GROUPING(v.articulo_id)=0 THEN 'articulo'",
  " WHEN GROUPING(v.vendedor_id)=0 THEN 'vendedor' ELSE 'horario' END AS kind,",
  " CASE WHEN GROUPING(v.articulo_id)=0 THEN coalesce(v.articulo_id,'')",
  " WHEN GROUPING(v.vendedor_id)=0 THEN coalesce(v.vendedor_id::text,'')",
  " ELSE (extract(isodow FROM v.fecha)::int::text || ':' || extract(hour FROM v.fecha)::int::text) END AS key,",
  " coalesce(sum(v.importe),0)::numeric AS sales,",
  " coalesce(sum(v.unidades),0)::numeric AS units,",
  " count(*)::bigint AS lines",
  " FROM "+q+".fm_ventas_analitica v",
  " WHERE v.farmacia_codigo=ANY($3::text[])",
  " AND v.fecha >= $1::date AND v.fecha < $2::date",
  " GROUP BY GROUPING SETS ((v.farmacia_codigo,v.articulo_id),",
  " (v.farmacia_codigo,v.vendedor_id),",
  " (v.farmacia_codigo,extract(isodow FROM v.fecha),extract(hour FROM v.fecha)))"
 ].join("\n");
}
export function mergePanoramaGroups(rows=[]){
 const groups=new Map();
 for(const row of rows){
  const code=String(row.code||"").trim().toUpperCase();
  const kind=String(row.kind||"");
  const key=String(row.key??"");
  if(!code||!["articulo","vendedor","horario"].includes(kind))continue;
  const groupKey=JSON.stringify([code,kind,key]);
  const current=groups.get(groupKey)||{code,kind,key,sales:0,units:0,lines:0};
  current.sales+=numeric(row.sales);
  current.units+=numeric(row.units);
  current.lines+=numeric(row.lines);
  groups.set(groupKey,current);
 }
 return [...groups.values()];
}
export async function summarizePanoramaGroups(pool,context,ids,groups){
 const chosen=(context.pharmacies||[]).filter(p=>ids.includes(Number(p.id)));
 const idByCode=new Map(chosen.map(p=>[
  String(p.databaseCode||p.sourceCode||"").trim().toUpperCase(),String(p.id)
 ]));
 const codes=[...idByCode.keys()];
 // Clasificar artículos después de sumar sus movimientos históricos.
 // Así una unificación actual del maestro se refleja sin modificar el cierre.
 const {rows:links}=await pool.query(
  "SELECT a.farmacia_codigo AS code,a.articulo_origen_id AS article,"+
  " g.id::text AS \"familyId\",g.nombre AS name,g.segmento AS segment"+
  " FROM farmetrica.familias_globales_articulos a"+
  " JOIN farmetrica.familias_globales g ON g.cliente_slug=a.cliente_slug"+
  " AND g.id=a.familia_id AND g.activo"+
  " WHERE a.cliente_slug=$1 AND a.farmacia_codigo=ANY($2::text[])",
  [context.client.slug,codes]);
 const lookup=new Map(links.map(r=>[
  JSON.stringify([String(r.code||"").trim().toUpperCase(),String(r.article)]),r
 ]));
 const families=new Map(),sellers=[],cells=[];
 for(const g of groups){
  if(g.kind==="articulo"){
   const link=lookup.get(JSON.stringify([g.code,g.key]));
   const id=link?.familyId||"";
   const old=families.get(id)||{familyId:link?.familyId||null,
    name:link?.name||null,segment:link?.segment||null,sales:0,units:0,lines:0};
   old.sales+=g.sales;old.units+=g.key.trim()?g.units:0;old.lines+=g.lines;
   families.set(id,old);
  }else if(g.kind==="vendedor"){
   const pharmacyId=idByCode.get(g.code);
   if(pharmacyId)sellers.push({pharmacyId,sellerId:g.key||null,
    sales:g.sales,units:g.units});
  }else if(g.kind==="horario"){
   const [weekday,hour]=g.key.split(":").map(Number);
   if(Number.isInteger(weekday)&&weekday>=1&&weekday<=7&&
      Number.isInteger(hour)&&hour>=0&&hour<=23)
    cells.push({weekday,hour,sales:g.sales,lines:g.lines});
  }
 }
 // Reagrupar el mapa entre farmacias: no enviamos entradas duplicadas a React.
 const byHour=new Map();
 for(const cell of cells){
  const k=cell.weekday+":"+cell.hour;
  const p=byHour.get(k)||{weekday:cell.weekday,hour:cell.hour,sales:0,lines:0};
  p.sales+=cell.sales;p.lines+=cell.lines;byHour.set(k,p);
 }
 // Una incidencia en el catálogo de nombres no debe inutilizar ni el mapa
 // ni los importes. Los IDs de vendedor son una alternativa válida.
 let named=sellers;
 try{named=await nameCommercialRows(pool,context,sellers)}
 catch(error){console.warn("FM_PANORAMA_NOMBRES_FALLBACK",error.code||error.name)}
 const activity=summarizeSalesActivityRows([],chosen,ids,named);
 activity.horarios={cells:[...byHour.values()].sort((a,b)=>a.weekday-b.weekday||a.hour-b.hour),
  total:[...byHour.values()].reduce((n,r)=>n+r.sales,0)};
 return {familias:mergeSalesFamilyRows([...families.values()]),actividad:activity};
}
export function createSalesPanoramaCache(pool,{logger=console}={}){
 const queued=new Set(),running=new Set(),failures=new Map();
 let tail=Promise.resolve();
 const clock=async()=>{
  const {rows}=await pool.query("SELECT to_char(clock_timestamp() AT TIME ZONE 'Europe/Madrid','YYYY-MM-DD') AS today");
  return rows[0].today;
 };
 async function refreshMonth({slug,schema,id,code,month}){
  const key=keyOf({slug,id,month});
  if(running.has(key)||!IDENT.test(slug)||!IDENT.test(schema))return false;
  running.add(key);
  let conn;
  try{
   if(month>=(await clock()).slice(0,7)+"-01")return false;
   conn=await pool.connect();
   await conn.query("BEGIN");
   await conn.query("SET LOCAL statement_timeout='115s'");
   await conn.query("SET LOCAL lock_timeout='5s'");
   await conn.query("SET LOCAL work_mem='16MB'");
   await conn.query("SET LOCAL max_parallel_workers_per_gather=1");
   const {rows:locks}=await conn.query(
    "SELECT pg_try_advisory_xact_lock(hashtext($1),$2::int) AS ok",
    ["fm-panorama-"+slug+"-"+month,Number(id)]);
   if(!locks[0]?.ok){await conn.query("ROLLBACK");return false}
   const {rows:existing}=await conn.query(
    "SELECT 1 FROM farmetrica.ventas_panorama_meses_cerrados"+
    " WHERE cliente_slug=$1 AND farmacia_id=$2 AND mes=$3::date",
    [slug,id,month]);
   if(existing.length){await conn.query("COMMIT");failures.delete(key);return true}
   const insert="INSERT INTO farmetrica.ventas_panorama_mensual"+
    " (cliente_slug,farmacia_id,mes,dimension,clave,importe,unidades,lineas)"+
    " SELECT $4,$5,$6::date,g.kind,g.key,sum(g.sales),sum(g.units),sum(g.lines)"+
    " FROM ("+buildSalesPanoramaGroupSQL(schema)+") g"+
    " GROUP BY g.kind,g.key"+
    " ON CONFLICT(cliente_slug,farmacia_id,mes,dimension,clave) DO NOTHING";
   await conn.query({text:insert,
    values:[month,nextMonth(month),[code],slug,id,month],query_timeout:120000});
   await conn.query("INSERT INTO farmetrica.ventas_panorama_meses_cerrados"+
    " (cliente_slug,farmacia_id,mes) VALUES ($1,$2,$3::date)"+
    " ON CONFLICT(cliente_slug,farmacia_id,mes) DO NOTHING",[slug,id,month]);
   await conn.query("COMMIT");
   failures.delete(key);
   logger.info?.("FM_PANORAMA_MES_CERRADO",slug,id,month);
   return true;
  }catch(error){
   if(conn)await conn.query("ROLLBACK").catch(()=>{});
   const n=(failures.get(key)||0)+1;failures.set(key,n);
   logger.error?.("FM_PANORAMA_PRECALCULO",slug,id,month,error.code||error.name,n);
   return false;
  }finally{conn?.release();running.delete(key)}
 }
 const schedule=(args)=>{
  const key=keyOf(args);
  if(queued.has(key)||running.has(key)||Number(failures.get(key)||0)>=3)return;
  queued.add(key);
  tail=tail.then(()=>refreshMonth(args)).catch(error=>
   logger.error?.("FM_PANORAMA_COLA",error.code||error.name))
   .finally(()=>queued.delete(key));
 };
 async function read({slug,schema,ids,pharmacies,from,to,context}){
  if(!IDENT.test(slug)||!IDENT.test(schema)||!validSalesDateRange(from,to))
   throw Error("Período o esquema no válido");
  const today=await clock();
  const periods=panoramaPeriods(from,to,today);
  if(!periods)return {status:"unsupported"};
  const selected=pharmacies.filter(p=>ids.includes(Number(p.id))).map(p=>({
   id:Number(p.id),code:String(p.databaseCode||p.sourceCode||"").trim().toUpperCase()
  }));
  if(!selected.length)return {status:"ready",
   data:await summarizePanoramaGroups(pool,context,ids,[])};
  if(selected.some(p=>!p.code))throw Error("Falta correspondencia ERP");
  let fromCache=[];
  if(periods.closed.length){
   const {rows:ready}=await pool.query(
    "SELECT farmacia_id,mes::text AS mes FROM farmetrica.ventas_panorama_meses_cerrados"+
    " WHERE cliente_slug=$1 AND farmacia_id=ANY($2::int[]) AND mes=ANY($3::date[])",
    [slug,selected.map(p=>p.id),periods.closed]);
   const present=new Set(ready.map(r=>r.farmacia_id+"|"+r.mes.slice(0,10)));
   const missing=[];
   for(const month of [...periods.closed].reverse()){
    for(const pharmacy of selected){
     if(!present.has(pharmacy.id+"|"+month))
      missing.push({slug,schema,id:pharmacy.id,code:pharmacy.code,month});
    }
   }
   if(missing.length){
    // Los cierres son secuenciales (una consulta de origen a la vez).
    // Antes solo se encolaban cinco por petición: un rango de 24 meses y
    // cinco farmacias necesitaba al menos 24 sondeos de 6 s para ENCOLAR,
    // aunque PostgreSQL terminara cada mes enseguida. Encolar el histórico
    // completo evita huecos ociosos entre sondeos, sin aumentar concurrencia.
    // El límite mantiene la memoria acotada en rangos/hospitales extremos.
    for(const item of missing.slice(0,300))schedule(item);
    const permanentlyFailed=missing.find(x=>Number(failures.get(keyOf(x))||0)>=3);
    if(permanentlyFailed)return {status:"error",
     error:"No se pudo preparar un mes del histórico. Revisa el registro de consultas."};
    return {status:"preparing",missing:missing.length,retryAfterMs:6000};
   }
   const {rows}=await pool.query(
    "SELECT farmacia_id,dimension AS kind,clave AS key,"+
    " sum(importe)::float8 AS sales,sum(unidades)::float8 AS units,sum(lineas)::bigint AS lines"+
    " FROM farmetrica.ventas_panorama_mensual"+
    " WHERE cliente_slug=$1 AND farmacia_id=ANY($2::int[])"+
    " AND mes=ANY($3::date[]) GROUP BY farmacia_id,dimension,clave",
    [slug,selected.map(p=>p.id),periods.closed]);
   const byId=new Map(selected.map(p=>[p.id,p.code]));
   fromCache=rows.map(r=>({...r,code:byId.get(Number(r.farmacia_id))}));
  }
  const codes=selected.map(p=>p.code);
  const raw=await Promise.all(periods.live.map(async range=>{
   let conn;
   try{
    conn=await pool.connect();
    await conn.query("BEGIN READ ONLY");
    await conn.query("SET LOCAL statement_timeout='105s'");
    await conn.query("SET LOCAL work_mem='16MB'");
    const result=await conn.query({text:buildSalesPanoramaGroupSQL(schema),
     values:[range.from,new Date(Date.parse(range.to+"T00:00:00Z")+86400000)
      .toISOString().slice(0,10),codes],
     query_timeout:112000});
    await conn.query("ROLLBACK");
    return result.rows;
   }catch(error){if(conn)await conn.query("ROLLBACK").catch(()=>{});throw error}
   finally{conn?.release()}
  }));
  const groups=mergePanoramaGroups([...fromCache,...raw.flat()]);
  return {status:"ready",data:await summarizePanoramaGroups(pool,context,ids,groups)};
 }
 return {read,refreshMonth,schedule};
}
export function setupSalesPanorama(app,pool,{requireTenant}){
 const cache=createSalesPanoramaCache(pool);
 app.get("/api/analytics/ventas/panorama",...requireTenant(),async(req,res,next)=>{
  try{
   const ctx=req.context||{};
   if(ctx.role!=="superadministrador"&&!ctx.modules?.ventas&&!ctx.modules?.dashboard)
    return res.status(403).json({error:"Módulo de ventas no habilitado"});
   const from=String(req.query.desde||""),to=String(req.query.hasta||"");
   const raw=String(req.query.farmacias||"");
   if(!validSalesDateRange(from,to)||raw.length>2000||
    (raw&&raw.split(",").some(id=>!/^[1-9]\d{0,8}$/.test(id))))
    return res.status(400).json({error:"Período o farmacias no válidos"});
   const allowed=(ctx.allowedPharmacyIds||[]).map(Number);
   const ids=[...new Set(raw?raw.split(",").map(Number):allowed)];
   if(ids.some(id=>!allowed.includes(id)))
    return res.status(403).json({error:"Farmacia no autorizada"});
   const result=await cache.read({slug:ctx.client.slug,schema:ctx.client.schema,
    ids,pharmacies:ctx.pharmacies||[],from,to,context:ctx});
   if(result.status==="preparing")return res.status(202).json(result);
   if(result.status==="error")return res.status(503).json({error:result.error});
   if(result.status==="unsupported")return res.status(400).json({
    error:"El período solicitado no se puede agregar"});
   res.setHeader?.("Cache-Control","private, no-store");
   return res.json(result.data);
  }catch(error){next(error)}
 });
 return cache;
}
