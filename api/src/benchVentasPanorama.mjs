// Benchmark de solo lectura, opt-in, sobre el período real de tres meses.
// No extrae CN, vendedores, importes ni datos comerciales en los logs.
// Activación auditada: BENCH_VENTAS_PANORAMA (solo lecturas y tres vistas agregadas).
import pg from "pg";
import {buildSalesFamilyRankingSQL} from "./salesOverview.js";
import {buildSalesActivitySQL} from "./salesActivity.js";
import {buildSalesTicketCountsSQL} from "./salesOverview.js";
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";

if(process.env.FM_BENCH_VENTAS_PANORAMA!=="1")
 throw Error("Benchmark de solo lectura no habilitado");
const pool=new pg.Client({connectionString:process.env.DATABASE_URL,
 connectionTimeoutMillis:5000,query_timeout:24000});
try{
 await pool.connect();
 await pool.query("BEGIN READ ONLY");
 await pool.query("SET LOCAL statement_timeout='20000ms'");
 await pool.query("SET LOCAL lock_timeout='3000ms'");
 await pool.query("SET LOCAL max_parallel_workers_per_gather=0");
 const [{rows:dates},{rows:farms}]=await Promise.all([
  pool.query("SELECT to_char(date_trunc('month',clock_timestamp() AT TIME ZONE 'Europe/Madrid')"+
   "-interval '3 months','YYYY-MM-DD') AS desde,"+
   "to_char(clock_timestamp() AT TIME ZONE 'Europe/Madrid','YYYY-MM-DD') AS hasta"),
  pool.query("SELECT DISTINCT "+pharmacyDataCodeSQL("f")+" AS code"+
   " FROM farmetrica.farmacias f WHERE f.cliente_slug='ampedia' AND f.activo LIMIT 6")
 ]);
 const from=dates[0].desde,to=dates[0].hasta;
 const codes=farms.map(r=>r.code).filter(Boolean);
 if(!codes.length)throw Error("No hay farmacias para el benchmark");
 const tasks=[
  ["Familias",buildSalesFamilyRankingSQL("ampedia"),[from,to,codes,"ampedia"]],
  ["Vendedores y mapa",buildSalesActivitySQL("ampedia"),[from,to,codes]],
  ["Ticket medio",buildSalesTicketCountsSQL("ampedia"),[from,to,codes]]
 ];
 for(const [name,sql,args] of tasks){
  const start=performance.now();
  try{
   const {rows}=await pool.query(sql,args);
   console.log("VENTAS_PANORAMA_BENCH",JSON.stringify({
    vista:name,meses:3,farmacias:codes.length,duracionMs:Math.round(performance.now()-start),
    grupos:rows.length,estado:"ok"
   }));
  }catch(error){
   console.log("VENTAS_PANORAMA_BENCH",JSON.stringify({
    vista:name,meses:3,farmacias:codes.length,duracionMs:Math.round(performance.now()-start),
    estado:"error",codigo:error.code||error.name
   }));
   // En una transacción abortada hay que abandonar el resto de medidas.
   throw error;
  }
 }
 await pool.query("ROLLBACK");
}catch(error){
 await pool.query("ROLLBACK").catch(()=>{});
 console.error("VENTAS_PANORAMA_ERROR",error.code||error.name);
 process.exitCode=1;
}finally{await pool.end()}
