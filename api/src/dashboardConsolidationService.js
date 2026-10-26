import pg from "pg";
import {buildDashboardMonthSQL,compatibleConsolidatedRange,
 summarizeConsolidations,madridDay} from "./dashboardConsolidations.js";
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";

const IDENT=/^[a-z][a-z0-9_]{1,62}$/;
const prevMonth=iso=>{
 const d=new Date(iso.slice(0,7)+"-01T00:00:00Z");
 d.setUTCMonth(d.getUTCMonth()-1);return d.toISOString().slice(0,10);
};
const nextMonth=iso=>{
 const d=new Date(iso.slice(0,7)+"-01T00:00:00Z");
 d.setUTCMonth(d.getUTCMonth()+1);return d.toISOString().slice(0,10);
};
const dayAfter=iso=>new Date(Date.parse(iso+"T00:00:00Z")+86400000).toISOString().slice(0,10);

export function createDashboardConsolidationService(pool,{now=()=>new Date(),logger=console}={}){
 const localToday=()=>madridDay(now()),running=new Set();
 const monthParams=(farms,month)=>[JSON.stringify(farms),month,nextMonth(month),month];
 async function sourceScopes(){
  const {rows}=await pool.query(
   "SELECT c.slug,c.esquema_datos AS schema,"+
   " json_agg(json_build_object('id',f.id,'code',"+pharmacyDataCodeSQL("f")+
   ") ORDER BY f.id) AS farms"+
   " FROM farmetrica.clientes c JOIN farmetrica.farmacias f ON f.cliente_slug=c.slug"+
   " WHERE c.activo AND c.demo_origen_slug IS NULL"+
   " GROUP BY c.slug,c.esquema_datos ORDER BY c.slug");
  return rows.filter(r=>IDENT.test(r.slug)&&IDENT.test(r.schema)&&r.farms?.length);
 }
 async function refreshMonth({slug,schema,farms,month},force=false){
  if(!IDENT.test(slug)||!IDENT.test(schema)||!Array.isArray(farms)||!farms.length||
   !/^\d{4}-\d{2}-01$/.test(month)||month>=localToday().slice(0,7)+"-01")return false;
  const key=slug+"|"+month;
  if(running.has(key))return false;
  running.add(key);
  let conn;
  try{
   conn=await pool.connect();
   await conn.query("BEGIN");
   await conn.query("SET LOCAL statement_timeout='85000ms'");
   await conn.query("SET LOCAL lock_timeout='5000ms'");
   await conn.query("SET LOCAL max_parallel_workers_per_gather=0");
   await conn.query("SET LOCAL work_mem='8MB'");
   const {rows:lock}=await conn.query(
    "SELECT pg_try_advisory_xact_lock(hashtext($1),$2::int) AS ok",
    ["fm-dashboard-"+slug,Number(month.slice(0,4)+month.slice(5,7))]);
   if(!lock[0]?.ok){await conn.query("ROLLBACK");return false}
   if(!force){
    const {rows:exists}=await conn.query(
     "SELECT count(*)::int AS n FROM farmetrica.dashboard_consolidados_mensuales"+
     " WHERE cliente_slug=$1 AND mes=$2::date",[slug,month]);
    if(Number(exists[0]?.n)===2*farms.length){await conn.query("COMMIT");return false}
   }
   for(const source of ["ventas","compras"]){
    const q=buildDashboardMonthSQL(schema,source);
    await conn.query(
     "INSERT INTO farmetrica.dashboard_consolidados_mensuales"+
     " (cliente_slug,farmacia_id,mes,fuente,importe,unidades,filas,filas_importe,"+
     " filas_unidades,filas_producto,documentos,filas_coste,ventas_con_coste,margen_coste,actualizado_en)"+
     " SELECT $5::text,x.farmacia_id,x.mes,x.fuente,x.importe,x.unidades,x.filas,"+
     " x.filas_importe,x.filas_unidades,x.filas_producto,x.documentos,x.filas_coste,"+
     " x.ventas_con_coste,x.margen_coste,now() FROM ("+q+") x"+
     " ON CONFLICT (cliente_slug,farmacia_id,mes,fuente) DO UPDATE SET"+
     " importe=EXCLUDED.importe,unidades=EXCLUDED.unidades,filas=EXCLUDED.filas,"+
     " filas_importe=EXCLUDED.filas_importe,filas_unidades=EXCLUDED.filas_unidades,"+
     " filas_producto=EXCLUDED.filas_producto,documentos=EXCLUDED.documentos,"+
     " filas_coste=EXCLUDED.filas_coste,ventas_con_coste=EXCLUDED.ventas_con_coste,"+
     " margen_coste=EXCLUDED.margen_coste,actualizado_en=now()",
     [...monthParams(farms,month),slug]);
   }
   await conn.query("COMMIT");
   return true;
  }catch(e){
   if(conn)await conn.query("ROLLBACK").catch(()=>{});
   logger.error?.("FM_DASHBOARD_CONSOLIDACION",slug,month,e.code||e.name);
   return false;
  }finally{conn?.release();running.delete(key)}
 }
 async function backfill({months=40,maxMs=540000,onMonth}={}){
  const started=Date.now(),status={processed:0,newMonths:0,alreadyReady:0,failures:0};
  const latest=prevMonth(localToday());
  for(const scope of await sourceScopes()){
   let month=latest;
   for(let i=0;i<months&&Date.now()-started<maxMs;i++,month=prevMonth(month)){
    const newMonth=await refreshMonth({...scope,month});
    const {rows}=await pool.query(
     "SELECT count(*)::int AS n FROM farmetrica.dashboard_consolidados_mensuales"+
     " WHERE cliente_slug=$1 AND mes=$2::date",[scope.slug,month]);
    const complete=Number(rows[0]?.n)===2*scope.farms.length;
    status.processed++;
    if(!complete){status.failures++;onMonth?.({month,complete:false});break}
    if(newMonth)status.newMonths++;else status.alreadyReady++;
    onMonth?.({month,complete:true,created:newMonth});
   }
  }
  return {...status,elapsedMs:Date.now()-started};
 }
 let lastNight="";
 async function runNightly(){
  const local=localToday(),hour=Number(new Intl.DateTimeFormat("en-GB",{
   timeZone:"Europe/Madrid",hour:"2-digit",hourCycle:"h23"}).format(now()));
  if(hour!==3||lastNight===local)return;
  lastNight=local;
  try{
   for(const scope of await sourceScopes()){
    const previous=prevMonth(local);
    // Corregir recepciones tardías y retroactivas recientes.
    await refreshMonth({...scope,month:previous},true);
    await refreshMonth({...scope,month:prevMonth(previous)},true);
   }
   // Si el servidor estuvo apagado, completar los huecos sin otro escaneo masivo.
   await backfill({months:48,maxMs:210000});
  }catch(e){logger.error?.("FM_DASHBOARD_NOCTURNO",e.code||e.name)}
 }
 function start(){
  const timer=setInterval(()=>{void runNightly()},15*60*1000);
  timer.unref?.();void runNightly();
 }
 async function read({slug,schema,ids,farms,from,to}){
  if(!IDENT.test(slug)||!IDENT.test(schema)||!ids.length)return {available:false,reason:"scope"};
  const range=compatibleConsolidatedRange(from,to,localToday());
  if(!range)return {available:false,reason:"range"};
  const rows=[];
  if(range.months.length){
   const end=range.active?range.activeMonth:nextMonth(to);
   const result=await pool.query(
    "SELECT farmacia_id,mes,fuente,importe,unidades,filas,filas_importe,"+
    " filas_unidades,filas_producto,documentos,filas_coste,ventas_con_coste,margen_coste"+
    " FROM farmetrica.dashboard_consolidados_mensuales"+
    " WHERE cliente_slug=$1 AND farmacia_id=ANY($2::int[])"+
    " AND mes>=$3::date AND mes<$4::date",
    [slug,ids,from,end]);
   const expected=range.months.length*ids.length*2;
   if(result.rows.length!==expected)
    return {available:false,reason:"pending",readyRows:result.rows.length,expectedRows:expected};
   rows.push(...result.rows);
  }
  if(range.active){
   // El mes actual sigue dinámico: el botón Actualizar lee datos recientes.
   let conn;
   try{
    conn=await pool.connect();
    await conn.query("BEGIN READ ONLY");
    await conn.query("SET LOCAL statement_timeout='45000ms'");
    await conn.query("SET LOCAL max_parallel_workers_per_gather=0");
    await conn.query("SET LOCAL work_mem='8MB'");
    for(const source of ["ventas","compras"]){
     const result=await conn.query(buildDashboardMonthSQL(schema,source),[
      JSON.stringify(farms),range.activeMonth,dayAfter(to),range.activeMonth]);
     rows.push(...result.rows);
    }
    await conn.query("ROLLBACK");
   }catch(e){if(conn)await conn.query("ROLLBACK").catch(()=>{});throw e}
   finally{conn?.release()}
  }
  return {available:true,cachedMonths:range.months.length,
   liveCurrentMonth:range.active,...summarizeConsolidations(rows,from,to)};
 }
 return {read,refreshMonth,backfill,runNightly,start,sourceScopes};
}
export function setupDashboardConsolidations(app,pool,{requireTenant}){
 const service=createDashboardConsolidationService(pool);
 app.get("/api/analytics/dashboard/consolidados",...requireTenant(),async(req,res,next)=>{
  const context=req.context;
  if(context.role!=="superadministrador"&&!context.modules?.dashboard)
   return res.status(403).json({error:"Inicio no habilitado"});
  const from=String(req.query.desde||""),to=String(req.query.hasta||""),
   raw=String(req.query.farmacias||"");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||
   from>to||raw.length>1000||
   (raw&&raw.split(",").some(x=>!/^[1-9]\d{0,8}$/.test(x))))
   return res.status(400).json({error:"Filtros incorrectos"});
  const allowed=new Set(context.allowedPharmacyIds.map(Number));
  const ids=raw?raw.split(",").map(Number):[...allowed];
  if(ids.some(id=>!allowed.has(id)))
   return res.status(403).json({error:"Farmacia no autorizada"});
  const unique=[...new Set(ids)];
  if(!unique.length)return res.json({available:true,...summarizeConsolidations([],from,to)});
  const codeById=new Map((context.pharmacies||[]).map(f=>[
   Number(f.id),String(f.databaseCode||f.sourceCode||"").trim().toUpperCase()]));
  const farms=unique.map(id=>({id,code:codeById.get(id)}));
  if(farms.some(f=>!f.code))return res.status(503).json({error:"Falta código ERP de farmacia"});
  try{
   res.json(await service.read({slug:context.client.slug,schema:context.client.schema,
    ids:unique,farms,from,to}));
  }catch(e){next(e)}
 });
 return service;
}
