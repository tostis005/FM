// Auditoría de solo lectura. No publica IDs, nombres, CN ni datos por farmacia.
import pg from "pg";
import {setupPromotionObjectives} from "./promocionesObjetivos.js";
import {calculatePromotionTracking} from "./promotionTrackingSales.js";
if(process.env.FM_PROMOTION_SALES_FLOW!=="VERIFY_20261107")throw Error("Auditoría no autorizada");
if(!process.env.DATABASE_URL)throw Error("Conexión no configurada");
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:3,
 connectionTimeoutMillis:5000,query_timeout:35000,statement_timeout:35000,
 options:"-c default_transaction_read_only=on -c lock_timeout=3s"});
const routes=new Map(),app={post(path,...handlers){routes.set(path,handlers.at(-1));}};
setupPromotionObjectives(app,pool,{requireTenantModule:()=>[]});
const sum=values=>Object.values(values||{}).reduce((n,v)=>n+Number(v||0),0);
const iso=s=>/^20\d{2}-\d{2}-\d{2}$/.test(String(s||""));
async function historical(ctx,cns,ids,from,to){
 const chunks=[];for(let i=0;i<cns.length;i+=100)chunks.push(cns.slice(i,i+100));
 const totals={};let next=0;
 await Promise.all(Array.from({length:Math.min(2,chunks.length)},async()=>{
  while(next<chunks.length){
   const i=next++;let data,status=200,error;
   const res={status(n){status=n;return res;},json(value){data=value;return res;}};
   await routes.get("/api/ventas/objetivos/historico")({
    body:{cns:chunks[i],pharmacyIds:ids,periods:[{id:"scope",from,to}]},context:ctx
   },res,e=>error=e);
   if(error)throw error;
   if(status!==200)throw Error("HTTP histórico "+status);
   for(const [id,v] of Object.entries(data.periods.scope||{}))
    totals[id]=(totals[id]||0)+Number(v);
  }
 }));
 return totals;
}
const parts=Object.fromEntries(new Intl.DateTimeFormat("en-GB",{
 timeZone:"Europe/Madrid",year:"numeric",month:"2-digit",day:"2-digit"
}).formatToParts(new Date()).filter(v=>v.type!=="literal").map(v=>[v.type,v.value]));
const today=[parts.year,parts.month,parts.day].join("-");
const stats={readOnly:true,checked:0,matching:0,unmatched:0,rows:[]};
try{
 const {rows:clients}=await pool.query(
  "SELECT esquema_datos AS schema FROM farmetrica.clientes WHERE slug=$1",["ampedia"]);
 const schema=clients[0]?.schema;
 if(!/^[a-z][a-z0-9_]{1,62}$/.test(schema||""))throw Error("Esquema no válido");
 const {rows:pharmacies}=await pool.query(
  "SELECT id FROM farmetrica.farmacias WHERE cliente_slug=$1 AND activo=true",["ampedia"]);
 const ids=pharmacies.map(p=>p.id);
 stats.pharmacies=ids.length;
 const {rows:source}=await pool.query({
  text:"SELECT documento FROM \""+schema+"\".fm_promociones"+
   " WHERE jsonb_typeof(documento->'cns')='array'"+
   " AND jsonb_array_length(documento->'cns')>0"+
   " ORDER BY CASE WHEN jsonb_array_length(documento->'cns')=267 THEN 0"+
   " WHEN (documento->>'start')<=$1::text"+
   " AND documento->'targets'<>'{}'::jsonb THEN 1 ELSE 2 END,"+
   " actualizado_en DESC LIMIT 12",
  values:[today],query_timeout:10000});
 stats.candidates=source.map(r=>({cnCount:(r.documento.cns||[]).length,
  targets:Object.keys(r.documento.targets||{}).length,
  status:r.documento.status||"?"}));
 const target267=source.find(r=>(r.documento.cns||[]).length===267);
 const priority=source.filter(r=>Object.keys(r.documento.targets||{}).length&&
  r.documento.start<=today&&r!==target267);
 const unassigned=source.find(r=>r!==target267&&
  !Object.keys(r.documento.targets||{}).length&&r.documento.start<=today);
 const picked=[...(target267?[target267]:[]),...priority.slice(0,1),
  ...(unassigned?[unassigned]:[])].slice(0,3);
 stats.hasExact267=Boolean(target267);
 stats.futureDatedCandidates=source.filter(r=>r.documento.start>today).length;
 if(!picked.length)throw Error("No hay promociones para comparar");
 const ctx={client:{slug:"ampedia",schema},allowedPharmacyIds:ids};
 for(const [index,row] of picked.entries()){
  const p=row.documento,cns=[...new Set((p.cns||[]).map(String).filter(c=>/^\d{6}$/.test(c)))];
  if(!iso(p.start)||!cns.length){stats.rows.push({index,error:"Inicio/CN inválidos"});continue;}
  let from=p.start,end=iso(p.closedOn)?p.closedOn:iso(p.end)?p.end:today;
  if(end>today)end=today;
  let historicalProbe=false;
  if(end<from){
   if(cns.length!==267){stats.rows.push({index,error:"Fecha futura"});continue;}
   // Una campaña futura tendrá cero ventas propias. Contrastar con el
   // mes anterior (en el que se conocen ventas de estos 267 CN) verifica
   // que seguimiento e histórico utilizan las mismas referencias reales.
   const y=Number(today.slice(0,4)),m=Number(today.slice(5,7));
   const lastPrevious=new Date(Date.UTC(y,m-1,0)).toISOString().slice(0,10);
   from=lastPrevious.slice(0,7)+"-01";
   end=lastPrevious;
   historicalProbe=true;
  }
  const first=Date.parse(from+"T00:00:00Z"),last=Date.parse(end+"T00:00:00Z");
  if((last-first)/86400000>366){stats.rows.push({index,error:"Duración mayor de un año"});continue;}
  const {sales,totalSales}=await calculatePromotionTracking(pool,ctx,[{...p,cns,start:from,end}]);
  const actual=await historical(ctx,cns,ids,from,end);
  const tracked=totalSales[p.id]||{},attributed=sales[p.id]||{};
  const mismatched=ids.filter(id=>Math.abs(Number(tracked[id]||0)-Number(actual[id]||0))>0.001);
  const summary={index,cnCount:cns.length,status:p.status,
   sourceMode:p.statusSource||"legacy",
   targetPharmacies:Object.keys(p.targets||{}).length,
   start:from,end,historicalProbe,
   campaignStartIsFuture:historicalProbe,
   trackingTotalUnits:sum(tracked),historicalTotalUnits:sum(actual),
   attributedUnits:sum(attributed),pharmacyMismatches:mismatched.length,
   matched:mismatched.length===0};
  stats.rows.push(summary);stats.checked++;
  if(summary.matched)stats.matching++;else stats.unmatched++;
 }
 if(!stats.checked)throw Error("No hay períodos pasados aptos para contrastar");
 console.log("PROMOTION_SALES_FLOW_AUDIT",JSON.stringify(stats));
 if(stats.unmatched)process.exitCode=2;
}catch(error){
 console.error("PROMOTION_SALES_FLOW_ERROR",JSON.stringify({
  code:error.code||error.name,reason:String(error.message||error).slice(0,130)}));
 process.exitCode=1;
}finally{await pool.end();}
