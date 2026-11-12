// Los años cerrados se derivan exclusivamente de los 12 consolidados
// mensuales inmutables: jamás recalcular movimientos de ejercicios cerrados.
const IDENT=/^[a-z][a-z0-9_]{1,62}$/;
const validYear=y=>Number.isSafeInteger(Number(y))&&Number(y)>=2010&&Number(y)<=2200;
export function splitConsolidatedYears(months=[]){
 const map=new Map();
 for(const month of months){
  const year=Number(String(month).slice(0,4));
  map.set(year,(map.get(year)||0)+1);
 }
 const years=[...map].filter(([,n])=>n===12).map(([y])=>y).sort((a,b)=>a-b);
 return {years,months:months.filter(m=>!years.includes(Number(m.slice(0,4))))};
}
export function buildAnnualInsertSQL(){
 return [
  "INSERT INTO farmetrica.dashboard_consolidados_anuales",
  " (cliente_slug,farmacia_id,anio,fuente,importe,unidades,documentos,filas,margen_coste,meses,actualizado_en)",
  " SELECT m.cliente_slug,m.farmacia_id,$2::int,m.fuente,",
  " sum(m.importe),sum(m.unidades),sum(m.documentos),sum(m.filas),sum(m.margen_coste),",
  " jsonb_agg(to_jsonb(m) ORDER BY m.mes),clock_timestamp()",
  " FROM farmetrica.dashboard_consolidados_mensuales m",
  " WHERE m.cliente_slug=$1 AND m.farmacia_id=ANY($3::int[])",
  " AND m.mes>=make_date($2::int,1,1) AND m.mes<make_date($2::int+1,1,1)",
  " GROUP BY m.cliente_slug,m.farmacia_id,m.fuente HAVING count(*)=12",
  " ON CONFLICT(cliente_slug,farmacia_id,anio,fuente) DO NOTHING"
 ].join("\n");
}
export function createDashboardAnnualService(pool,{dbClock,logger=console}={}){
 const running=new Set();
 async function refreshYear({slug,farms,year}){
  if(!IDENT.test(slug)||!Array.isArray(farms)||!farms.length||!validYear(year))return false;
  const {today}=await dbClock();
  if(Number(year)>=Number(today.slice(0,4)))return false;
  const ids=farms.map(p=>Number(p.id)).filter(Number.isSafeInteger);
  if(ids.length!==farms.length)return false;
  const key=slug+"|"+year;
  if(running.has(key))return false;
  running.add(key);
  let conn;
  try{
   conn=await pool.connect();
   await conn.query("BEGIN");
   await conn.query("SET LOCAL statement_timeout='15000ms'");
   await conn.query("SET LOCAL lock_timeout='4000ms'");
   const {rows:[lock]}=await conn.query(
    "SELECT pg_try_advisory_xact_lock(hashtext($1),$2::int) AS ok",
    ["fm-dashboard-annual-"+slug,Number(year)]);
   if(!lock?.ok){await conn.query("ROLLBACK");return false}
   const {rows:[count]}=await conn.query(
    "SELECT count(*)::int AS n FROM farmetrica.dashboard_consolidados_anuales"+
    " WHERE cliente_slug=$1 AND anio=$2 AND farmacia_id=ANY($3::int[])",
    [slug,Number(year),ids]);
   if(Number(count?.n)===ids.length*2){await conn.query("COMMIT");return false}
   await conn.query(buildAnnualInsertSQL(),[slug,Number(year),ids]);
   await conn.query("COMMIT");
   return true;
  }catch(error){
   if(conn)await conn.query("ROLLBACK").catch(()=>{});
   logger.error?.("FM_DASHBOARD_ANUAL",slug,year,error.code||error.name);
   return false;
  }finally{conn?.release();running.delete(key)}
 }
 async function readYears({slug,ids,years}){
  if(!years.length)return {rows:[],matchedYears:[]};
  if(!IDENT.test(slug)||!ids?.length||years.some(y=>!validYear(y)))
   return {rows:[],matchedYears:[]};
  const {rows:annual}=await pool.query(
   "SELECT farmacia_id,anio,fuente,meses FROM farmetrica.dashboard_consolidados_anuales"+
   " WHERE cliente_slug=$1 AND farmacia_id=ANY($2::int[]) AND anio=ANY($3::int[])",
   [slug,ids,years]);
  const matchedYears=[],rows=[];
  for(const year of years){
   const records=annual.filter(x=>Number(x.anio)===year);
   if(records.length!==2*ids.length||
      records.some(r=>!Array.isArray(r.meses)||r.meses.length!==12))continue;
   matchedYears.push(year);
   for(const record of records){
    for(const month of record.meses){
     rows.push({...month,farmacia_id:Number(record.farmacia_id),fuente:record.fuente});
    }
   }
  }
  return {rows,matchedYears};
 }
 return {refreshYear,readYears};
}
