// Diagnóstico puntal en el propio VPS. Solo SELECT; imprime contadores,
// nunca documentos, artículos, códigos de proveedor ni credenciales.
// Se invoca desde CI únicamente tras despliegues etiquetados Cinfa.
import pg from "pg";
import {readDirectLaboratoryCatalog,laboratoryLinkEvidence} from "./laboratoryFastCatalog.js";
const pool=new pg.Pool({
 connectionString:process.env.DATABASE_URL,max:2,connectionTimeoutMillis:4000,
 statement_timeout:30000,query_timeout:35000
});
const key="N:CINFA";
const result={laboratory:key,client:"ampedia",pharmacies:0};
try{
 const [{rows:clients},{rows:pharmacies}]=await Promise.all([
  pool.query("SELECT esquema_datos FROM farmetrica.clientes WHERE slug=$1",["ampedia"]),
  pool.query("SELECT id FROM farmetrica.farmacias WHERE cliente_slug=$1 ORDER BY id",["ampedia"])
 ]);
 if(!clients[0]||!/^[a-z][a-z0-9_]{1,62}$/.test(clients[0].esquema_datos)){
  console.log("CINFA_PROD_DIAGNOSTIC",JSON.stringify({...result,error:"Cliente no disponible"}));
 }else{
  const ctx={client:{slug:"ampedia",schema:clients[0].esquema_datos},pharmacies};
  const ids=pharmacies.map(p=>Number(p.id));
  result.pharmacies=ids.length;
  try{result.evidence=await laboratoryLinkEvidence(pool,ctx,{key,pharmacies:ids})}
  catch(e){result.evidenceError=e.code||e.message.slice(0,120)}
  for(const type of ["medicacion","parafarmacia"]){
   try{
    const catalog=await readDirectLaboratoryCatalog(pool,ctx,{
     key,pharmacies:ids,type,page:1,size:1,search:""
    });
    result[type]={count:catalog.total,status:"ok"};
   }catch(e){result[type]={status:"error",code:e.code||e.name,
    detail:String(e.message||"").slice(0,180)}}
  }
  console.log("CINFA_PROD_DIAGNOSTIC",JSON.stringify(result));
 }
}catch(e){console.log("CINFA_PROD_DIAGNOSTIC",JSON.stringify({
 error:e.code||e.name,detail:String(e.message||"").slice(0,180)
}))}finally{await pool.end()}
