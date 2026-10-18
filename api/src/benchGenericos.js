// Medir la consulta de Genéricos directamente en PostgreSQL de producción.
// Solo lectura, sin imprimir datos comerciales ni información de pacientes.
import pg from "pg";
import {setupGenericosReales} from "./genericosReales.js";
if(process.env.FM_BENCHMARK_READONLY!=="1")throw Error("Sólo prueba de lectura explícita");
const db=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000});
const routes=new Map();
setupGenericosReales({get:(p,...h)=>routes.set(p,h.at(-1))},db,
 {requireTenantModule:()=>[]});
const handler=routes.get("/api/genericos/reales");
try{
 await db.connect();
 await db.query("BEGIN READ ONLY");
 await db.query("SET LOCAL statement_timeout='45000ms'");
 await db.query("SET LOCAL lock_timeout='4000ms'");
 for(const [name,ids] of [["Valdemarías",[5]],["Red completa",[1,2,3,4,5]]]){
  const req={context:{
    client:{slug:"ampedia",schema:"ampedia"},
    allowedPharmacyIds:[1,2,3,4,5]},
    query:{desde:"2026-07-18",hasta:"2026-10-18",farmacias:ids.join(",")},params:{}};
  let status=200,body,error;
  const res={status(x){status=x;return res},json(x){body=x;return res}};
  const start=process.hrtime.bigint();
  await handler(req,res,e=>{error=e});
  const ms=Number(process.hrtime.bigint()-start)/1e6;
  if(error)throw error;
  if(status!==200)throw Error("Genéricos HTTP "+status);
  console.log("Genéricos "+name+": "+ms.toFixed(0)+" ms; "+
    (body?.groups?.length||0)+" conjuntos, sin imprimir importes ni CN");
 }
 await db.query("ROLLBACK");
}catch(e){
 console.log("Benchmark Genéricos interrumpido: "+String(e.code||e.name));
 try{await db.query("ROLLBACK")}catch{}
 process.exitCode=1;
}finally{await db.end()}
