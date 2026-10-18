// Benchmark manual READ ONLY; sin mostrar unidades, dinero ni datos de artículos.
import pg from "pg";
import {buildRecentProductCountSQL} from "./salesInsights.js";
import {buildSalesTotalsSql} from "./salesTotals.js";
if(process.env.FM_BENCHMARK_READONLY!=="1")throw Error("Solo benchmarking explícito");
const db=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000});
const cases=[["Valdemarías",["VAL"]],["Red",["ABA","EUR","BUE","EST","VAL"]]];
try{
 await db.connect();
 await db.query("BEGIN READ ONLY");
 await db.query("SET LOCAL statement_timeout='20000ms'");
 await db.query("SET LOCAL lock_timeout='4000ms'");
 for(const [name,codes] of cases){
  for(const [label,sql,args] of [
    ["recuento 12 meses",buildRecentProductCountSQL("ampedia"),[codes,"2025-11-01","2026-10-18"]],
    ["ventas 5 años",buildSalesTotalsSql("ampedia","month"),["2021-11-01","2026-10-18",codes]],
    ["ventas todo el histórico",buildSalesTotalsSql("ampedia","month"),["1900-01-01","2026-10-18",codes]]
  ]){
   const t=process.hrtime.bigint();
   try{
    const result=await db.query(sql,args);
    console.log(name+" "+label+": "+(Number(process.hrtime.bigint()-t)/1e6).toFixed(0)+" ms; "+
     (result.rows.length||0)+" grupos");
   }catch(error){console.log(name+" "+label+": BLOQUEO O ERROR "+(error.code||error.name));throw error;}
  }
 }
 await db.query("ROLLBACK");
}catch(e){try{await db.query("ROLLBACK")}catch{}process.exitCode=1}
finally{await db.end()}
