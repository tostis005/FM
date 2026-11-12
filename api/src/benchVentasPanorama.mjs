// Benchmark de Ventas en datos reales, solo lectura y sin imprimir importes,
// nombres, CN ni identificadores comerciales. Activación opt-in.
import pg from "pg";
import {buildSalesPanoramaGroupSQL} from "./salesPanorama.js";
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";

if(process.env.FM_BENCH_VENTAS_PANORAMA!=="1")
 throw Error("Benchmark no habilitado");
const db=new pg.Client({connectionString:process.env.DATABASE_URL,
 connectionTimeoutMillis:8000,query_timeout:110000,statement_timeout:30000});
try{
 await db.connect();
 await db.query("BEGIN READ ONLY");
 await db.query("SET LOCAL statement_timeout='95s'");
 await db.query("SET LOCAL work_mem='16MB'");
 const {rows:dates}=await db.query(
  "SELECT to_char((clock_timestamp() AT TIME ZONE 'Europe/Madrid')::date-interval '8 days','YYYY-MM-DD') AS desde,"+
  "to_char((clock_timestamp() AT TIME ZONE 'Europe/Madrid')::date,'YYYY-MM-DD') AS hasta");
 const {rows:pharmacies}=await db.query(
  "SELECT "+pharmacyDataCodeSQL("f")+" AS code FROM farmetrica.farmacias f"+
  " WHERE f.cliente_slug='ampedia' AND f.activo ORDER BY f.id LIMIT 1");
 const code=pharmacies[0]?.code;
 if(!code)throw Error("Farmacia sin correspondencia ERP");
 const values=[dates[0].desde,dates[0].hasta,[code]];
 const sql=buildSalesPanoramaGroupSQL("ampedia");
 const {rows:explain}=await db.query({text:"EXPLAIN (FORMAT JSON) "+sql,values});
 const plan=explain[0]?.["QUERY PLAN"]?.[0]?.Plan;
 console.log("VENTAS_PANORAMA_PLAN",JSON.stringify({node:plan?.["Node Type"],cost:plan?.["Total Cost"]}));
 const start=performance.now();
 const {rows}=await db.query({text:sql,values,query_timeout:110000});
 console.log("VENTAS_PANORAMA_BENCH",JSON.stringify({dias:8,farmacias:1,
  duracionMs:Math.round(performance.now()-start),grupos:rows.length,estado:"ok"}));
 const {rows:cached}=await db.query(
  "SELECT count(*)::int AS n FROM farmetrica.ventas_panorama_meses_cerrados"+
  " WHERE cliente_slug='ampedia'");
 console.log("VENTAS_PANORAMA_CIERRES",JSON.stringify({grupos:cached[0]?.n||0}));
 await db.query("ROLLBACK");
}catch(error){
 await db.query("ROLLBACK").catch(()=>{});
 console.error("VENTAS_PANORAMA_ERROR",error.code||error.name);
 process.exitCode=1;
}finally{await db.end()}
