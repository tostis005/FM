// Diagnóstico de stock y ventas de 700 CN en el catálogo real, solo lectura.
// No publica nombres, CN, stock por farmacia ni datos de ventas.
import pg from "pg";
import {setupPromotionObjectives} from "./promocionesObjetivos.js";
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";

if(process.env.FM_PROMOTION_STOCK_700!=="1")throw Error("Falta activación explícita");
if(!process.env.DATABASE_URL)throw Error("Conexión PostgreSQL no configurada");
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:3,
 connectionTimeoutMillis:5000,query_timeout:35000,statement_timeout:35000,
 options:"-c default_transaction_read_only=on -c lock_timeout=3s"});
const routes=new Map();
const app={post(path,...handlers){routes.set(path,handlers.at(-1));}};
setupPromotionObjectives(app,pool,{requireTenantModule:()=>[]});
async function request(body,context){
 let status=200,payload=null,error=null;
 const res={status(code){status=code;return res;},json(value){payload=value;return res;}};
 await routes.get("/api/ventas/objetivos/historico")({body,context},res,err=>error=err);
 if(error)throw error;
 if(status!==200)throw Error("HTTP "+status);
 return payload;
}
const result={requestedCN:700,batchSize:100,maxConcurrent:2};
try{
 const {rows:clients}=await pool.query("SELECT esquema_datos AS schema FROM farmetrica.clientes WHERE slug=$1",["ampedia"]);
 const schema=clients[0]?.schema;
 if(!/^[a-z][a-z0-9_]{1,62}$/.test(schema||""))throw Error("Esquema de farmacia incorrecto");
 const {rows:pharmacies}=await pool.query("SELECT id FROM farmetrica.farmacias WHERE cliente_slug=$1 AND activo=true",["ampedia"]);
 const pharmacyIds=pharmacies.map(p=>p.id);
 if(!pharmacyIds.length)throw Error("No hay farmacias activas");
 result.pharmacies=pharmacyIds.length;
 const {rows:sample}=await pool.query({text:
  "SELECT DISTINCT btrim(a.origen_id::text) AS cn FROM \""+schema+"\".articulos a "+
  "JOIN farmetrica.farmacias f ON f.cliente_slug=$1 AND upper(btrim(a.farmacia_codigo))="+pharmacyDataCodeSQL("f")+
  " WHERE f.id=ANY($2::int[]) AND btrim(a.origen_id::text) ~ '^[0-9]{6}$' LIMIT 700",
  values:["ampedia",pharmacyIds],query_timeout:16000});
 const codes=sample.map(r=>r.cn),seen=new Set(codes);
 result.existingCN=codes.length;
 for(let i=0;codes.length<700;i++){
  const cn=String(i).padStart(6,"0");
  if(!seen.has(cn)){seen.add(cn);codes.push(cn);}
 }
 const periods=[
  {id:"october",from:"2026-10-01",to:"2026-10-31"},
  {id:"year",from:"2025-10-01",to:"2025-10-31"},
  {id:"twoYears",from:"2024-10-01",to:"2024-10-31"},
  {id:"november",from:"2026-11-01",to:"2026-11-06"}
 ];
 const context={client:{slug:"ampedia",schema},allowedPharmacyIds:pharmacyIds};
 const batches=[];for(let i=0;i<codes.length;i+=100)batches.push(codes.slice(i,i+100));
 const totals={},missing=new Set(),failed=new Set(),timings=[];
 let cursor=0;
 const started=Date.now();
 await Promise.all(Array.from({length:2},async()=>{
  while(cursor<batches.length){
   const i=cursor++,startedBatch=Date.now();
   const data=await request({cns:batches[i],pharmacyIds,periods},context);
   timings[i]=Date.now()-startedBatch;
   if(data.stockUnavailable)for(const id of pharmacyIds)failed.add(String(id));
   for(const id of data.stockMissingPharmacyIds||[])missing.add(String(id));
   for(const [id,n] of Object.entries(data.stock||{})){
    totals[id]=(totals[id]||0)+Number(n);
   }
  }
 }));
 result.elapsedMs=Date.now()-started;
 result.maxBatchMs=Math.max(...timings);
 result.batches=timings.length;
 result.pharmaciesWithKnownStock=Object.keys(totals).length;
 result.pharmaciesWithNoKnownStock=pharmacyIds.filter(id=>!Object.hasOwn(totals,String(id))).length;
 result.pharmaciesWithPartialStock=new Set([...missing,...failed]).size;
 result.pharmaciesWithStockQueryFailure=failed.size;
 console.log("PROMOTION_STOCK_700_OK",JSON.stringify(result));
}catch(e){
 console.error("PROMOTION_STOCK_700_ERROR",JSON.stringify({...result,
  code:e.code||e.name||"ERROR",reason:String(e.message||"").replace(/[^A-Za-z0-9 _.-]/g,"").slice(0,140)}));
 process.exitCode=1;
}finally{await pool.end();}
