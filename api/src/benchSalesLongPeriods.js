// Comparativa de dos años en PostgreSQL real, estrictamente de solo lectura.
// No imprime dinero, unidades, nombres ni identificadores de artículos.
// Se ejecuta solamente mediante el workflow opt-in posterior al despliegue.
import pg from "pg";
import {buildSalesTotalsSql} from "./salesTotals.js";
import {createSalesMonthlyReader} from "./salesCachedMonthly.js";
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";

if(process.env.FM_BENCH_VENTAS_24M!=="1")throw Error("Benchmark no habilitado");
const {Pool}=pg;
const pool=new Pool({connectionString:process.env.DATABASE_URL,max:2,
 connectionTimeoutMillis:6000,statement_timeout:25000,query_timeout:28000});
const millis=()=>Number(process.hrtime.bigint())/1e6;
const iso=date=>date.toISOString().slice(0,10);
const same=(a,b)=>Number.isFinite(Number(a))&&Number.isFinite(Number(b))&&
 Math.abs(Number(a)-Number(b))<0.03;
let exitCode=0;
try{
 const {rows:[clock]}=await pool.query(
  "SELECT to_char(clock_timestamp() AT TIME ZONE 'Europe/Madrid','YYYY-MM-DD') AS today");
 const first=new Date(clock.today.slice(0,7)+"-01T00:00:00Z");
 const start=new Date(first);start.setUTCMonth(start.getUTCMonth()-24);
 const from=iso(start);
 const to=iso(new Date(first.getTime()-86400000));
 const {rows:[pharmacy]}=await pool.query(
  "SELECT f.id,"+pharmacyDataCodeSQL("f")+" AS code"+
  " FROM farmetrica.farmacias f WHERE f.cliente_slug='ampedia'"+
  " AND f.activo ORDER BY f.id LIMIT 1");
 if(!pharmacy?.code)throw Error("No hay farmacia activa para medir");
 const ids=[Number(pharmacy.id)],farms=[{id:Number(pharmacy.id),code:String(pharmacy.code)}];
 const {rows:[coverage]}=await pool.query(
  "SELECT count(*)::int AS n FROM farmetrica.dashboard_consolidados_mensuales"+
  " WHERE cliente_slug='ampedia' AND farmacia_id=$1 AND fuente='ventas'"+
  " AND mes >= $2::date AND mes < $3::date",
  [ids[0],from,iso(first)]);
 const reader=createSalesMonthlyReader(pool,{
  dbClock:async()=>({today:clock.today}),
  scheduleMonth:()=>{} // Benchmark READ ONLY: no generar ni sobrescribir cierres.
 });
 const tFast=millis();
 const fast=await reader({slug:"ampedia",schema:"ampedia",ids,farms,from,to});
 const cachedMs=Math.round(millis()-tFast);
 const summary={meses:24,cierresDisponibles:Number(coverage.n)||0,
  lecturaConsolidadaMs:cachedMs,lecturaConsolidadaLista:fast.available===true};
 if(fast.available!==true){
  console.log("FM_VENTAS_24M",JSON.stringify({...summary,
   resultado:"pendiente_de_cierres",motivo:fast.reason}));
 }else{
  let oldMs=null,old=null,oldError=null;
  const conn=await pool.connect();
  try{
   await conn.query("BEGIN READ ONLY");
   await conn.query("SET LOCAL statement_timeout='20000ms'");
   const tOld=millis();
   try{
    const result=await conn.query({text:buildSalesTotalsSql("ampedia","month"),
     values:[from,to,farms.map(x=>x.code)],query_timeout:23000});
    oldMs=Math.round(millis()-tOld);
    old=result.rows[0]||null;
   }catch(error){
    oldError=error.code||error.name;
   }
   await conn.query("ROLLBACK");
  }finally{conn.release();}
  if(old&&fast.sales.kpis.ventas==null){
   console.log("FM_VENTAS_24M",JSON.stringify({...summary,
    consultaOriginalMs:oldMs,resultado:"importes_incompletos_no_comparables"}));
  }else if(old){
   const equalSales=same(old.total_ventas,fast.sales.kpis.ventas);
   const equalUnits=same(old.total_unidades,fast.sales.kpis.unidades);
   const equalMargin=fast.sales.kpis.margen===null?true:
    same(old.total_margen,fast.sales.kpis.margen);
   console.log("FM_VENTAS_24M",JSON.stringify({...summary,
    consultaOriginalMs:oldMs,aceleracion:oldMs&&cachedMs?
     Number((oldMs/cachedMs).toFixed(1)):null,
    importesCoinciden:equalSales,unidadesCoinciden:equalUnits,
    margenCoincide:equalMargin,
    resultado:equalSales&&equalUnits&&equalMargin?"equivalente":"diferencia_detectada"}));
   if(!equalSales||!equalUnits||!equalMargin)exitCode=1;
  }else{
   console.log("FM_VENTAS_24M",JSON.stringify({...summary,
    resultado:"consulta_original_no_completada_en_20s",
    error:oldError}));
  }
 }
 // Cobertura del panorama que alimenta familias, vendedores y franjas.
 // Solo leer agregados ya cerrados; nunca provocar preparaciones en producción.
 const {rows:active}=await pool.query(
  "SELECT id FROM farmetrica.farmacias WHERE cliente_slug='ampedia'"+
  " AND activo ORDER BY id");
 const activeIds=active.map(f=>Number(f.id));
 if(activeIds.length){
  const {rows:[p]}=await pool.query(
   "SELECT count(*)::int AS n FROM farmetrica.ventas_panorama_meses_cerrados"+
   " WHERE cliente_slug='ampedia' AND farmacia_id=ANY($1::int[])"+
   " AND mes >= $2::date AND mes < $3::date",
   [activeIds,from,iso(first)]);
  const expected=activeIds.length*24;
  const info={meses:24,farmacias:activeIds.length,
   cierresPreparados:Number(p.n)||0,cierresNecesarios:expected};
  if(Number(p.n)!==expected){
   console.log("FM_VENTAS_PANORAMA_24M",JSON.stringify({...info,
    resultado:"cierres_pendientes"}));
  }else{
   const months=Array.from({length:24},(_,i)=>{
    const d=new Date(start);d.setUTCMonth(d.getUTCMonth()+i);
    return iso(d);
   });
   let conn,elapsed=null,groups=null,dbError=null;
   try{
    conn=await pool.connect();
    await conn.query("BEGIN READ ONLY");
    await conn.query("SET LOCAL statement_timeout='20000ms'");
    await conn.query("SET LOCAL work_mem='16MB'");
    const t=millis();
    const {rows}=await conn.query({
     text:"SELECT farmacia_id,dimension AS kind,clave AS key,"+
      " sum(importe)::float8 AS sales,sum(unidades)::float8 AS units,"+
      " sum(lineas)::bigint AS lines FROM farmetrica.ventas_panorama_mensual"+
      " WHERE cliente_slug=$1 AND farmacia_id=ANY($2::int[])"+
      " AND mes=ANY($3::date[]) GROUP BY farmacia_id,dimension,clave",
     values:["ampedia",activeIds,months],query_timeout:23000
    });
    elapsed=Math.round(millis()-t);groups=rows.length;
   }catch(error){dbError=error.code||error.name}
   finally{
    if(conn){
     await conn.query("ROLLBACK").catch(()=>{});
     conn.release();
    }
   }
   console.log("FM_VENTAS_PANORAMA_24M",JSON.stringify({...info,
    lecturaAgrupadaMs:elapsed,grupos:groups,
    resultado:dbError?"timeout_o_error":"medido",
    error:dbError}));
  }
 }
}catch(error){
 console.error("FM_VENTAS_24M_ERROR",error.code||error.name);
 exitCode=1;
}finally{await pool.end()}
if(exitCode)process.exitCode=exitCode;
