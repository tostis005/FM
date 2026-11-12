// Lectura específica para Ventas: no consulta Compras ni obliga a recomputar
// dos años porque falte una sola mensualidad cerrada.
// Las cifras finales siempre incluyen todos los meses seleccionados.
import {compatibleConsolidatedRange,buildDashboardMonthSQL,summarizeConsolidations} from "./dashboardConsolidations.js";
const IDENT=/^[a-z][a-z0-9_]{1,62}$/;
const date=x=>x instanceof Date?x.toISOString().slice(0,10):String(x).slice(0,10);
const dayAfter=iso=>new Date(Date.parse(iso+"T00:00:00Z")+86400000).toISOString().slice(0,10);
const monthEnd=month=>{
 const d=new Date(month+"T00:00:00Z");d.setUTCMonth(d.getUTCMonth()+1);
 return new Date(d.getTime()-86400000).toISOString().slice(0,10);
};
export function createSalesMonthlyReader(pool,{dbClock,scheduleMonth}){
 return async function readSales({slug,schema,ids,farms,from,to}){
  if(!IDENT.test(slug)||!IDENT.test(schema)||!Array.isArray(ids)||!ids.length)
   return {available:false,reason:"scope"};
  const range=compatibleConsolidatedRange(from,to,(await dbClock()).today);
  if(!range)return {available:false,reason:"range"};
  const chosen=farms.filter(f=>ids.includes(Number(f.id))&&f.code);
  if(chosen.length!==ids.length)return {available:false,reason:"scope"};
  const {rows:cached}=range.months.length?await pool.query(
   "SELECT farmacia_id,mes,fuente,importe,unidades,filas,filas_importe,"+
   " filas_unidades,filas_producto,documentos,filas_coste,ventas_con_coste,margen_coste"+
   " FROM farmetrica.dashboard_consolidados_mensuales"+
   " WHERE cliente_slug=$1 AND farmacia_id=ANY($2::int[])"+
   " AND mes=ANY($3::date[]) AND fuente='ventas'",
   [slug,ids,range.months]):{rows:[]};
  const existing=new Set(cached.map(row=>String(row.farmacia_id)+"|"+date(row.mes)));
  const missing=range.months.map(month=>({month,
   farms:chosen.filter(f=>!existing.has(String(f.id)+"|"+month))}))
   .filter(x=>x.farms.length);
  // Completar los cierres en segundo plano: el informe no necesita esperar.
  for(const item of missing)scheduleMonth({slug,schema,farms:chosen},item.month);
  // Con pocos huecos, leer solo esos meses del ERP. Si casi todo falta,
  // conservar el fallback existente en vez de disparar cientos de consultas.
  const maxMissing=Math.min(6,Math.max(2,Math.ceil(range.months.length/4)));
  if(missing.length>maxMissing)return {available:false,reason:"pending"};
  const jobs=[...missing.map(x=>({month:x.month,from:x.month,
    to:monthEnd(x.month),farms:x.farms})),
   ...range.liveRanges.map(x=>({...x,farms:chosen}))];
  const rows=[...cached];
  if(jobs.length){
   let conn;
   try{
    conn=await pool.connect();
    await conn.query("BEGIN READ ONLY");
    await conn.query("SET LOCAL statement_timeout='60000ms'");
    await conn.query("SET LOCAL max_parallel_workers_per_gather=0");
    await conn.query("SET LOCAL work_mem='8MB'");
    for(const job of jobs){
     const result=await conn.query(buildDashboardMonthSQL(schema,"ventas"),[
      JSON.stringify(job.farms),job.from,dayAfter(job.to),job.month]);
     rows.push(...result.rows);
    }
    await conn.query("ROLLBACK");
   }catch(error){if(conn)await conn.query("ROLLBACK").catch(()=>{});throw error}
   finally{conn?.release()}
  }
  const data=summarizeConsolidations(rows,from,to);
  return {...data,available:true,cachedMonths:range.months.length-missing.length,
   liveRanges:range.liveRanges.length,missingLiveMonths:missing.length,
   immutable:missing.length===0};
 };
}
