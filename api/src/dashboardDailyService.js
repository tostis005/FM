import {buildDashboardMonthSQL,compatibleDailyRange,madridDay,
 summarizeConsolidations} from "./dashboardConsolidations.js";

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
const dayCount=(from,to)=>Math.round((Date.parse(to+"T00:00:00Z")-
 Date.parse(from+"T00:00:00Z"))/86400000);

export function createDashboardDailyService(pool,{sourceScopes,now=()=>new Date(),logger=console}={}){
 const today=()=>madridDay(now()),running=new Set();
 async function refreshDays({slug,schema,farms,month},force=false){
  const current=today().slice(0,7)+"-01";
  if(!IDENT.test(slug)||!IDENT.test(schema)||!Array.isArray(farms)||!farms.length||
   !/^\d{4}-\d{2}-01$/.test(month)||month>current)return false;
  const end=month===current?today():nextMonth(month);
  const days=dayCount(month,end);
  if(days<=0)return false;
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
   const {rows:locks}=await conn.query(
    "SELECT pg_try_advisory_xact_lock(hashtext($1),$2::int) AS ok",
    ["fm-dashboard-daily-"+slug,Number(month.slice(0,4)+month.slice(5,7))]);
   if(!locks[0]?.ok){await conn.query("ROLLBACK");return false}
   if(!force){
    const {rows:present}=await conn.query(
     "SELECT count(*)::int AS n FROM farmetrica.dashboard_consolidados_diarios"+
     " WHERE cliente_slug=$1 AND dia >= $2::date AND dia < $3::date",
     [slug,month,end]);
    if(Number(present[0]?.n)===2*days*farms.length){
     await conn.query("COMMIT");return false;
    }
   }
   for(const source of ["ventas","compras"]){
    await conn.query(
     "INSERT INTO farmetrica.dashboard_consolidados_diarios"+
     " (cliente_slug,farmacia_id,dia,fuente,importe,unidades,filas,filas_importe,"+
     " filas_unidades,filas_producto,documentos,filas_coste,ventas_con_coste,margen_coste,actualizado_en)"+
     " SELECT $5::text,x.farmacia_id,x.dia,x.fuente,x.importe,x.unidades,x.filas,"+
     " x.filas_importe,x.filas_unidades,x.filas_producto,x.documentos,x.filas_coste,"+
     " x.ventas_con_coste,x.margen_coste,now() FROM ("+
     buildDashboardMonthSQL(schema,source,{daily:true})+") x"+
     " ON CONFLICT(cliente_slug,farmacia_id,dia,fuente) DO UPDATE SET"+
     " importe=EXCLUDED.importe,unidades=EXCLUDED.unidades,filas=EXCLUDED.filas,"+
     " filas_importe=EXCLUDED.filas_importe,filas_unidades=EXCLUDED.filas_unidades,"+
     " filas_producto=EXCLUDED.filas_producto,documentos=EXCLUDED.documentos,"+
     " filas_coste=EXCLUDED.filas_coste,ventas_con_coste=EXCLUDED.ventas_con_coste,"+
     " margen_coste=EXCLUDED.margen_coste,actualizado_en=now()",
     [JSON.stringify(farms),month,end,month,slug]);
   }
   await conn.query("COMMIT");
   return true;
  }catch(e){
   if(conn)await conn.query("ROLLBACK").catch(()=>{});
   logger.error?.("FM_DASHBOARD_DIAS",slug,month,e.code||e.name);
   return false;
  }finally{conn?.release();running.delete(key)}
 }
 async function backfillDays({months=3,maxMs=180000,onMonth}={}){
  const start=Date.now(),status={processed:0,newMonths:0,alreadyReady:0,failures:0};
  const reference=today(),latest=reference.slice(0,7)+"-01";
  for(const scope of await sourceScopes()){
   let month=latest;
   for(let i=0;i<months&&Date.now()-start<maxMs;i++,month=prevMonth(month)){
    const created=await refreshDays({...scope,month});
    const end=month===latest?reference:nextMonth(month);
    const days=dayCount(month,end);
    const {rows}=await pool.query(
     "SELECT count(*)::int AS n FROM farmetrica.dashboard_consolidados_diarios"+
     " WHERE cliente_slug=$1 AND dia >= $2::date AND dia < $3::date",
     [scope.slug,month,end]);
    const complete=Number(rows[0]?.n)===days*scope.farms.length*2;
    status.processed++;
    if(!complete){status.failures++;onMonth?.({month,complete:false});break}
    if(created)status.newMonths++;else status.alreadyReady++;
    onMonth?.({month,complete:true,created});
   }
  }
  return {...status,elapsedMs:Date.now()-start};
 }
 async function readDays({slug,schema,ids,farms,from,to}){
  if(!IDENT.test(slug)||!IDENT.test(schema)||!ids?.length||!farms?.length)
   return {available:false,reason:"scope"};
  const range=compatibleDailyRange(from,to,today());
  if(!range)return {available:false,reason:"daily-range"};
  const rows=[];
  if(range.days>0){
   const result=await pool.query(
    "SELECT date_trunc('month',dia)::date AS mes,fuente,importe,unidades,filas,"+
    " filas_importe,filas_unidades,filas_producto,documentos,filas_coste,"+
    " ventas_con_coste,margen_coste"+
    " FROM farmetrica.dashboard_consolidados_diarios"+
    " WHERE cliente_slug=$1 AND farmacia_id=ANY($2::int[])"+
    " AND dia >= $3::date AND dia < $4::date",
    [slug,ids,from,dayAfter(range.closedTo)]);
   const expected=range.days*ids.length*2;
   if(result.rows.length!==expected)
    return {available:false,reason:"daily-pending",readyRows:result.rows.length,expectedRows:expected};
   rows.push(...result.rows);
  }
  if(range.live){
   let conn;
   try{
    conn=await pool.connect();
    await conn.query("BEGIN READ ONLY");
    await conn.query("SET LOCAL statement_timeout='45000ms'");
    await conn.query("SET LOCAL max_parallel_workers_per_gather=0");
    await conn.query("SET LOCAL work_mem='8MB'");
    const month=to.slice(0,7)+"-01";
    for(const source of ["ventas","compras"]){
     const result=await conn.query(buildDashboardMonthSQL(schema,source),
      [JSON.stringify(farms),to,dayAfter(to),month]);
     rows.push(...result.rows);
    }
    await conn.query("ROLLBACK");
   }catch(e){if(conn)await conn.query("ROLLBACK").catch(()=>{});throw e}
   finally{conn?.release()}
  }
  return {available:true,cachedDays:range.days,liveToday:range.live,
   ...summarizeConsolidations(rows,from,to)};
 }
 return {refreshDays,backfillDays,readDays};
}
