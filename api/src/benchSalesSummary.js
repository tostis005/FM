// Benchmark manual de lectura; no revela importes ni artículos en CI.
import pg from "pg";
import {buildSalesSummarySql} from "./salesSummary.js";
import {buildSalesTotalsSql} from "./salesTotals.js";
if(process.env.FM_BENCHMARK_READONLY!=="1")throw Error("Benchmark solo con activación explícita");
const client=new pg.Client({connectionString:process.env.DATABASE_URL,
 connectionTimeoutMillis:5000});
const cases=[{label:"Abadía",ids:[1]},{label:"Valdemarías",ids:[5]},
 {label:"Red seleccionada",ids:[1,2,3,4,5]}];
try{
 await client.connect();
 await client.query("BEGIN READ ONLY");
 await client.query("SET LOCAL statement_timeout='25000ms'");
 await client.query("SET LOCAL lock_timeout='5000ms'");
 for(const item of cases){
  const begin=process.hrtime.bigint();
  try{
   const {rows}=await client.query(buildSalesTotalsSql("ampedia","month"),
    ["2025-11-01","2026-10-18",item.ids,"ampedia"]);
   const ms=Number(process.hrtime.bigint()-begin)/1e6;
   console.log("SUM 12 meses "+item.label+": "+ms.toFixed(0)+
    " ms; "+rows.filter(r=>r.tipo==="month").length+" meses; sin importes");
  }catch(e){
   console.error("SUM 12 meses "+item.label+": ERROR "+String(e.code||e.name));
   throw e;
  }
 }
 if(process.env.FM_BENCHMARK_FAST_ONLY!=="1")for(const item of cases){
  const begin=process.hrtime.bigint();
  try{
   const {rows}=await client.query(buildSalesSummarySql("ampedia","month"),
    ["2026-07-18","2026-10-18",item.ids,"ampedia","",[]]);
   const ms=Number(process.hrtime.bigint()-begin)/1e6;
   const result=rows[0];
   console.log(item.label+": "+ms.toFixed(0)+" ms; "+(result?.counts?.total_products??0)+" agrupaciones (sin datos comerciales)");
  }catch(e){
   console.error(item.label+": ERROR "+String(e.code||e.name));
   throw e;
  }
 }
 await client.query("ROLLBACK");
}catch(e){
 try{await client.query("ROLLBACK")}catch{}
 process.exitCode=1;
}finally{await client.end()}
