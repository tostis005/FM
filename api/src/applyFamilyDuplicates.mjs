// Operación única, idempotente y auditada. Recomprueba todos los CN
// antes de modificar asignaciones. Nunca altera el maestro Farmatic original.
import pg from "pg";
import {readFile} from "node:fs/promises";
import {applyApprovedFamilyMerges} from "./familyDuplicateMerge.js";
const slug=process.argv.includes("--cliente")?
 process.argv[process.argv.indexOf("--cliente")+1]:"ampedia";
const apply=process.argv.includes("--apply");
if(!process.env.DATABASE_URL)throw Error("DATABASE_URL ausente");
const approvals=JSON.parse(await readFile(new URL("./familyDuplicateApprovals.json",import.meta.url),"utf8"));
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:2,
 connectionTimeoutMillis:10000,query_timeout:155000,statement_timeout:155000});
try{
 const results=await applyApprovedFamilyMerges(pool,slug,approvals,{apply});
 console.log("FAMILIAS_DUPLICADAS_FUSION",JSON.stringify({
  cliente:slug,modo:apply?"aplicado":"verificacion",
  aprobadas:approvals.length,fusionadas:results.filter(x=>x.status==="fusionado").length,
  yaAplicadas:results.filter(x=>x.status==="ya_aplicado").length,
  omitidas:results.filter(x=>x.status==="omitido").length,resultados:results
 }));
}finally{await pool.end()}
