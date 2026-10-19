// Cache servidor de análisis comercial de ventas.
// Se actualiza de madrugada y cuando la primera lectura detecta >24 h.
// No se modifican artículos/ventas/compras de ningún ERP.
import {buildSalesDetailSQL,SALES_DETAIL_SORT_KEYS} from "./salesDetail.js";
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
import {salesCacheColumnWhereSQL} from "./salesColumnFilters.js";

const IDENT=/^[a-z][a-z0-9_]{1,62}$/;
const MAX_ROWS=75000;
const CHUNK=300;
const DAY=86400000;
const numeric=new Set(["pvp","purchaseCost","saleUnitPrice","unitMargin","units","value","margin","marginPct"]);
const dateParts=(now,zone="Europe/Madrid")=>{
 const p=new Intl.DateTimeFormat("en-GB",{timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(now);
 const get=x=>p.find(v=>v.type===x).value;
 return get("year")+"-"+get("month")+"-"+get("day");
};
export function analysisWindow(months,now=new Date(),zone="Europe/Madrid"){
 const to=dateParts(now,zone),m=Number(months);
 if(![3,6,12,24,36].includes(m))throw Error("Período ABCD inválido");
 const end=new Date(to+"T00:00:00Z");
 const from=new Date(Date.UTC(end.getUTCFullYear(),end.getUTCMonth()+1-m,1)).toISOString().slice(0,10);
 return {from,to};
}
async function sourceTypes(conn,schema){
 const {rows}=await conn.query(
  "SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=ANY($2::text[])",
  [schema,["fm_ventas_analitica","fm_recepciones_analitica","articulos","productos"]]);
 const cols=new Map();
 for(const row of rows){if(!cols.has(row.table_name))cols.set(row.table_name,new Set());cols.get(row.table_name).add(row.column_name)}
 const has=(tbl,...names)=>names.every(name=>cols.get(tbl)?.has(name));
 if(!has("fm_ventas_analitica","farmacia_codigo","articulo_id","fecha","unidades","importe"))return null;
 return {articles:has("articulos","farmacia_codigo","origen_id","nombre","familia","codigo_nacional","pvp","pmc","sincronizado_en")?"normalized":
    has("productos","id","descripcion","cn","familia")?"legacy":"none",
   purchases:has("fm_recepciones_analitica","farmacia_codigo","articulo_id","fecha","unidades","coste_unitario")?"normalized":
    has("fm_recepciones_analitica","farmacia_id","producto_id","fecha","unidades","puc")?"legacy":"none"};
}
export function createSalesCache(pool,{now=()=>new Date(),logger=console,autoRun=true}={}){
 const running=new Set(),queued=new Set();
 let pending=Promise.resolve();
 const zone=process.env.FM_ANALYTICS_TIMEZONE||"Europe/Madrid";
 const current=months=>analysisWindow(months,now(),zone);
 async function refreshOne({slug,schema,pharmacyId,code,months},force=false){
  if(!IDENT.test(slug)||!IDENT.test(schema)||!/^[1-9]\d*$/.test(String(pharmacyId))||
     !String(code||"").trim()||![3,6,12,24,36].includes(Number(months)))return false;
  const id=Number(pharmacyId),m=Number(months),ref=slug+"|"+id+"|"+m;
  if(running.has(ref))return false;
  running.add(ref);
  let conn;
  try{
   conn=await pool.connect();
   await conn.query("BEGIN");
   const {rows:[lock]}=await conn.query(
    "SELECT pg_try_advisory_xact_lock(hashtext($1),$2::int) AS acquired",["fm-sales-cache-"+slug+"-"+m,id]);
   if(!lock?.acquired){await conn.query("ROLLBACK");return false}
   const range=current(m);
   const {rows:[status]}=await conn.query(
    "SELECT desde::text AS desde,hasta::text AS hasta,calculado_en FROM farmetrica.ventas_analitica_estado WHERE cliente_slug=$1 AND farmacia_id=$2 AND analisis_meses=$3",
    [slug,id,m]);
   if(!force&&status?.desde===range.from&&status?.hasta===range.to&&
      now().getTime()-new Date(status.calculado_en).getTime()<23*60*60*1000){
    await conn.query("COMMIT");return false;
   }
   const source=await sourceTypes(conn,schema);
   if(!source){await conn.query("ROLLBACK");return false}
   await conn.query("SET LOCAL statement_timeout='240s'");
   const {rows}=await conn.query(buildSalesDetailSQL(schema,"value","desc",source),
    [range.from,range.to,[String(code).trim().toUpperCase()],[String(id)],"",[],MAX_ROWS+1,0,"{}"]);
   if(rows.length>MAX_ROWS)throw Error("Más referencias de las admitidas por lote nocturno");
   // Todo el reemplazo es una transacción: el navegador siempre consulta
   // o la versión antigua completa o la nueva, nunca un precálculo a medias.
   await conn.query("DELETE FROM farmetrica.ventas_analitica_cache WHERE cliente_slug=$1 AND farmacia_id=$2 AND analisis_meses=$3",
    [slug,id,m]);
   for(let at=0;at<rows.length;at+=CHUNK){
    const part=rows.slice(at,at+CHUNK).map(row=>({
     cn:String(row.cn),detalle:{...row,id:String(id)+"|"+row.cn,pharmacyId:String(id)}
    }));
    await conn.query(`INSERT INTO farmetrica.ventas_analitica_cache
      (cliente_slug,farmacia_id,analisis_meses,cn,detalle)
      SELECT $1,$2,$3,x.cn,x.detalle
      FROM jsonb_to_recordset($4::jsonb) AS x(cn text,detalle jsonb)`,
      [slug,id,m,JSON.stringify(part)]);
   }
   await conn.query(`INSERT INTO farmetrica.ventas_analitica_estado
    (cliente_slug,farmacia_id,analisis_meses,desde,hasta,calculado_en,referencias)
    VALUES($1,$2,$3,$4::date,$5::date,now(),$6)
    ON CONFLICT(cliente_slug,farmacia_id,analisis_meses)
    DO UPDATE SET desde=EXCLUDED.desde,hasta=EXCLUDED.hasta,
      calculado_en=EXCLUDED.calculado_en,referencias=EXCLUDED.referencias`,
    [slug,id,m,range.from,range.to,rows.length]);
   await conn.query("COMMIT");
   logger.info?.("Precálculo ABCD actualizado",slug,id,m,rows.length);
   return true;
  }catch(err){
   if(conn)await conn.query("ROLLBACK").catch(()=>{});
   logger.error?.("Error de precálculo de ventas",slug,id,err.code||err.message);
   return false;
  }finally{conn?.release();running.delete(ref)}
 }
 const schedule=(args,force=false)=>{
  // Un único refresco pesado por proceso: abrir cinco farmacias no debe
  // disparar cinco GROUP BY anuales simultáneos contra PostgreSQL.
  const ref=args.slug+"|"+args.pharmacyId+"|"+args.months;
  if(running.has(ref)||queued.has(ref))return;
  queued.add(ref);
  pending=pending.then(()=>refreshOne(args,force))
   .catch(e=>logger.error?.("Error cola nocturna",e.code||e.name))
   .finally(()=>queued.delete(ref));
 };
 async function read({slug,ids,months,from,to,search="",families=[],sortKey="value",sortDir="desc",page=1,pageSize=400,columnFilters={}}){
  if(!IDENT.test(slug)||!ids.length||!SALES_DETAIL_SORT_KEYS.includes(sortKey)||
    !["asc","desc"].includes(sortDir))return null;
  const expected=current(months);
  if(expected.from!==from||expected.to!==to)return null;
  try{
   const {rows:states}=await pool.query(`
    SELECT farmacia_id,calculado_en,to_char(hasta,'YYYY-MM-DD') AS hasta
    FROM farmetrica.ventas_analitica_estado
    WHERE cliente_slug=$1 AND analisis_meses=$2
      AND farmacia_id=ANY($3::int[]) AND desde=$4::date
      AND hasta >= $5::date-interval '2 days'
      AND calculado_en > now()-interval '72 hours'`,
    [slug,months,ids,from,to]);
   if(states.length!==ids.length)return null;
   const direction=sortDir.toUpperCase();
   const sort=sortKey==="pharmacy"?"f.nombre":
     numeric.has(sortKey)?`(i.detalle->>'${sortKey}')::double precision`:
      `i.detalle->>'${sortKey}'`;
   const {rows}=await pool.query(`
     SELECT i.detalle,count(*) OVER()::int AS "__totalFiltered"
     FROM farmetrica.ventas_analitica_cache i
     JOIN farmetrica.farmacias f ON f.id=i.farmacia_id AND f.cliente_slug=i.cliente_slug
     WHERE i.cliente_slug=$1 AND i.analisis_meses=$2 AND i.farmacia_id=ANY($3::int[])
      AND ($4::text='' OR i.cn ILIKE '%'||$4||'%' OR i.detalle->>'name' ILIKE '%'||$4||'%')
      AND (cardinality($5::text[])=0 OR i.detalle->>'family'=ANY($5::text[]))
      AND (i.detalle->>'units')::float8>0
      AND ${salesCacheColumnWhereSQL("i","$8")}
     ORDER BY ${sort} ${direction} NULLS LAST,i.farmacia_id,i.cn
     LIMIT $6 OFFSET $7`,
    [slug,months,ids,search,families,pageSize+1,(page-1)*pageSize,JSON.stringify(columnFilters)]);
   const stale=states.some(s=>now().getTime()-new Date(s.calculado_en).getTime()>24*60*60*1000||
     String(s.hasta).slice(0,10)!==to);
   return {products:rows.slice(0,pageSize).map(r=>r.detalle),hasMore:rows.length>pageSize,
    totalFiltered:Number(rows[0]?.__totalFiltered||0),
    page,cache:true,stale,cacheAsOf:states.reduce((date,r)=>{
     const t=new Date(r.calculado_en).getTime();return Math.min(date,t)
    },Infinity)};
  }catch(e){
   logger.error?.("No se pudo consultar cache ventas",e.code||e.name);
   return null;
  }
 }
 let lastNightlyDay="";
 async function runNightly(){
  const day=dateParts(now(),zone),hour=Number(new Intl.DateTimeFormat("en-GB",
   {timeZone:zone,hour:"2-digit",hourCycle:"h23"}).format(now()));
  if(hour!==3||lastNightlyDay===day)return;
  lastNightlyDay=day;
  try{
   const {rows}=await pool.query(`SELECT c.slug,c.esquema_datos AS schema,
       c.analisis_abcd_meses AS months,f.id AS "pharmacyId",
       ${pharmacyDataCodeSQL("f")} AS code
     FROM farmetrica.clientes c JOIN farmetrica.farmacias f ON f.cliente_slug=c.slug
     WHERE c.activo AND f.activo AND c.demo_origen_slug IS NULL
     ORDER BY c.slug,f.id`);
   // Una farmacia cada vez; no bloquear sincronizadores con cinco análisis simultáneos.
   for(const row of rows)await refreshOne(row);
  }catch(e){logger.error?.("Error del programador de análisis",e.code||e.name)}
 }
 function start(){
  if(!autoRun)return;
  // El proceso de la API es el planificador. No requiere sincronizador ni
  // el navegador abierto. El bloqueo PostgreSQL impide trabajo duplicado.
  const timer=setInterval(()=>{void runNightly()},15*60*1000);
  timer.unref?.();
  void runNightly();
 }
 return {read,schedule,refreshOne,start,runNightly,
  isCacheRange:({from,to,months})=>{
   const range=current(months);
   return range.from===from&&range.to===to;
  }};
}
