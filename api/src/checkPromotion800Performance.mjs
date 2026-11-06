// Prueba real de solo lectura de 800 CN contra el PostgreSQL del VPS.
import pg from "pg";
import {setupPromotionObjectives} from "./promocionesObjetivos.js";
import {resolvePromotionArticleKeys} from "./promocionesArticulos.js";
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";

if(process.env.FM_PROMOTION_BENCH_800!=="1")throw Error("Activación explícita requerida");
if(!process.env.DATABASE_URL)throw Error("Base de datos no disponible");
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:3,
 connectionTimeoutMillis:5000,statement_timeout:30000,query_timeout:35000,
 options:"-c default_transaction_read_only=on -c lock_timeout=3s"});
const report={requested:800,batchSize:100,concurrency:2};
const routes=new Map(),app={post(path,...handlers){routes.set(path,handlers.at(-1));}};
setupPromotionObjectives(app,pool,{requireTenantModule:()=>[]});
async function request(path,body,context){
 const req={body,context};let status=200,value=null,failure=null;
 const res={status(n){status=n;return res;},json(v){value=v;return res;}};
 await routes.get(path)(req,res,error=>{failure=error;});
 if(failure)throw failure;
 if(status!==200)throw Error("HTTP "+status);
 return value;
}
async function batches(cns,fn){
 const chunks=[];for(let i=0;i<cns.length;i+=100)chunks.push(cns.slice(i,i+100));
 let cursor=0;const timings=[];
 const started=Date.now();
 const worker=async()=>{while(cursor<chunks.length){
   const i=cursor++,now=Date.now();
   await fn(chunks[i]);timings[i]=Date.now()-now;
 }};
 await Promise.all([worker(),worker()]);
 return {batches:chunks.length,wallMs:Date.now()-started,maxBatchMs:Math.max(...timings)};
}
try{
 const {rows:clients}=await pool.query("SELECT esquema_datos AS schema FROM farmetrica.clientes WHERE slug='ampedia'");
 const schema=clients[0]?.schema;
 if(!/^[a-z][a-z0-9_]{1,62}$/.test(schema||""))throw Error("No hay cliente validado");
 const {rows:pharmacies}=await pool.query("SELECT id FROM farmetrica.farmacias WHERE cliente_slug='ampedia' AND activo=true");
 const ids=pharmacies.map(p=>p.id),slug="ampedia";
 if(!ids.length)throw Error("No hay farmacias activas");
 const {rows:sample}=await pool.query({text:
  "SELECT DISTINCT btrim(a.origen_id::text) AS cn FROM \""+schema+"\".articulos a "+
  "JOIN farmetrica.farmacias f ON f.cliente_slug=$1 AND upper(btrim(a.farmacia_codigo))="+pharmacyDataCodeSQL("f")+
  " WHERE f.id=ANY($2::int[]) AND length(btrim(a.origen_id::text))=6 AND btrim(a.origen_id::text)~'^[0-9]+$' LIMIT 800",
  values:[slug,ids],query_timeout:16000});
 const cns=sample.map(r=>r.cn);
 report.existingCN=cns.length;
 const seen=new Set(cns);
 for(let i=0;cns.length<800;i++){
  const cn=String(i).padStart(6,"0");
  if(!seen.has(cn)){seen.add(cn);cns.push(cn);}
 }
 if(cns.length!==800)throw Error("No se pudieron seleccionar 800 códigos");
 const context={client:{slug,schema},allowedPharmacyIds:ids};
 const periods=[
  {id:"previous",from:"2026-10-01",to:"2026-10-31"},
  {id:"year",from:"2025-10-01",to:"2025-10-31"},
  {id:"twoYears",from:"2024-10-01",to:"2024-10-31"},
  {id:"custom",from:"2026-11-01",to:"2026-11-06"}
 ];
 report.catalog=await batches(cns,chunk=>request("/api/ventas/objetivos/buscar",
  {search:"",cns:chunk},context));
 report.history=await batches(cns,chunk=>request("/api/ventas/objetivos/historico",
  {cns:chunk,pharmacyIds:ids,periods},context));
 const started=Date.now();
 const keys=await resolvePromotionArticleKeys(pool,context,cns);
 const articleIds=[...new Set([...cns,...keys.map(x=>x.key.split("|").slice(1).join("|")).filter(Boolean)])];
 const {rows:count}=await pool.query({text:
  "SELECT count(*)::int AS total FROM \""+schema+"\".fm_ventas_analitica v "+
  "JOIN farmetrica.farmacias f ON f.cliente_slug=$1 "+
  "AND upper(btrim(v.farmacia_codigo::text))="+pharmacyDataCodeSQL("f")+
  " WHERE f.id=ANY($2::int[]) AND v.fecha >= $3::date AND "+
  "v.fecha < ($4::date+interval '1 day') AND btrim(v.articulo_id::text)=ANY($5::text[]) "+
  "AND (btrim(v.articulo_id::text)=ANY($6::text[]) OR "+
  "f.id::text||'|'||btrim(v.articulo_id::text)=ANY($7::text[]))",
  values:[slug,ids,"2026-10-01","2026-10-31",articleIds,cns,keys.map(x=>x.key)],
  query_timeout:30000});
 report.ticketCount={wallMs:Date.now()-started,hasMatches:Number(count[0]?.total||0)>0};
 console.log("PROMOTION_800_READONLY_OK",JSON.stringify(report));
}catch(error){
 console.error("PROMOTION_800_READONLY_FAIL",JSON.stringify({
  ...report,code:error.code||error.name||"ERROR",
  detail:String(error.message||"").replace(/[^A-Za-z0-9 _.-]/g,"").slice(0,120)}));
 process.exitCode=1;
}finally{await pool.end();}
