// Auditoría de solo lectura del histórico de la promoción de ~267 CN.
// Dos métodos independientes: API actual en lotes y SQL por mes sin lote.
// Nunca imprime CN, nombres de productos, IDs de promoción ni cantidades por farmacia.
import pg from "pg";
import {setupPromotionObjectives} from "./promocionesObjetivos.js";
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
if(process.env.FM_PROMO_HISTORY_267!=="CHECK_20261107")
 throw Error("Falta activación explícita de la auditoría");
if(!process.env.DATABASE_URL)throw Error("Falta conexión PostgreSQL");
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:3,
 connectionTimeoutMillis:5000,statement_timeout:34000,query_timeout:34000,
 options:"-c default_transaction_read_only=on -c lock_timeout=3s"});
const report={targetCN:267,readOnly:true};
const routes=new Map(),app={post(path,...fns){routes.set(path,fns.at(-1));}};
setupPromotionObjectives(app,pool,{requireTenantModule:()=>[]});
const same=(a,b)=>Math.abs(a-b)<0.001;
async function request(body,context){
 let result,code=200,err;
 const res={status(n){code=n;return res;},json(v){result=v;return res;}};
 await routes.get("/api/ventas/objetivos/historico")({body,context},res,e=>{err=e;});
 if(err)throw err;
 if(code!==200)throw Error("Histórico HTTP "+code);
 return result;
}
const sumMap=map=>Object.values(map||{}).reduce((n,v)=>n+(Number(v)||0),0);
try{
 const {rows:clients}=await pool.query(
  "SELECT esquema_datos AS schema FROM farmetrica.clientes WHERE slug=$1",["ampedia"]);
 const schema=clients[0]?.schema;
 if(!/^[a-z][a-z0-9_]{1,62}$/.test(schema||""))throw Error("Esquema de cliente no válido");
 const {rows:pharmacies}=await pool.query(
  "SELECT id FROM farmetrica.farmacias WHERE cliente_slug=$1 AND activo=true",["ampedia"]);
 const pharmacyIds=pharmacies.map(f=>f.id);
 if(!pharmacyIds.length)throw Error("No hay farmacias activas");
 report.pharmacies=pharmacyIds.length;
 const {rows:candidates}=await pool.query({
  text:"SELECT id,documento,actualizado_en FROM \""+schema+"\".fm_promociones"+
   " WHERE jsonb_typeof(documento->'cns')='array'"+
   " ORDER BY abs(jsonb_array_length(documento->'cns')-267), actualizado_en DESC LIMIT 7",
  query_timeout:10000});
 report.candidates=candidates.map(r=>({cnCount:r.documento.cns.length,
  isDraft:r.documento.status==="Borrador",
  hasTargets:Object.keys(r.documento.targets||{}).length>0}));
 const chosen=candidates.find(r=>r.documento.cns.length===267&&r.documento.status==="Borrador")||
  candidates.find(r=>r.documento.status==="Borrador")||candidates[0];
 if(!chosen)throw Error("No hay promociones guardadas");
 const codes=[...new Set(chosen.documento.cns.map(String).filter(v=>/^\d{6}$/.test(v)))];
 report.selectedCN=codes.length;
 report.invalidOrRepeatedCN=chosen.documento.cns.length-codes.length;
 report.exact267=codes.length===267;
 report.campaignWasDraft=chosen.documento.status==="Borrador";
 if(codes.length<1)throw Error("Promoción elegida sin CN válidos");
 const {rows:metadata}=await pool.query({
  text:"SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='articulos'",
  values:[schema],query_timeout:8000});
 const hasNormal=metadata.some(r=>r.column_name==="cn_normalizado");
 const normalMatch=hasNormal?" OR left(btrim(a.cn_normalizado::text),6)=ANY($3::text[])":"";
 const matchProducts="(a.origen_id::text=ANY($3::text[]) OR "+
  "left(btrim(a.codigo_nacional::text),6)=ANY($3::text[])"+normalMatch+")";
 const {rows:masters}=await pool.query({text:
  "SELECT DISTINCT f.id::text AS pharmacy_id,btrim(a.origen_id::text) AS source_id,"+
  " left(btrim(a.codigo_nacional::text),6) AS cn,"+
  (hasNormal?" left(btrim(a.cn_normalizado::text),6) AS norm_cn":" NULL::text AS norm_cn")+
  " FROM \""+schema+"\".articulos a JOIN farmetrica.farmacias f "+
  "ON f.cliente_slug=$1 AND upper(btrim(a.farmacia_codigo))="+pharmacyDataCodeSQL("f")+
  " WHERE f.id=ANY($2::int[]) AND "+matchProducts,
  values:["ampedia",pharmacyIds,codes],query_timeout:16000});
 const selected=new Set(codes),matched=new Set(),internal=new Set();
 for(const row of masters){
  for(const cn of [row.cn,row.norm_cn,row.source_id])if(selected.has(cn))matched.add(cn);
  if(row.source_id)internal.add(row.pharmacy_id+"|"+row.source_id);
 }
 report.masterMatchedDistinctCN=matched.size;
 report.masterUnmatchedCN=codes.length-matched.size;
 report.masterMatchedPharmacyArticleKeys=internal.size;
 const today=new Intl.DateTimeFormat("en-CA",{year:"numeric",month:"2-digit",day:"2-digit",
  timeZone:"Europe/Madrid"}).format(new Date());
 const y=Number(today.slice(0,4)),m=Number(today.slice(5,7));
 const monthOf=(year,month)=>year+"-"+String(month).padStart(2,"0");
 const prevYear=m===1?y-1:y,prevMonth=m===1?12:m-1;
 const periods=[
  {id:"previous",from:monthOf(prevYear,prevMonth)+"-01",
   to:monthOf(prevYear,prevMonth)+"-"+new Date(Date.UTC(prevYear,prevMonth,0)).getUTCDate()},
  {id:"year",from:monthOf(prevYear-1,prevMonth)+"-01",
   to:monthOf(prevYear-1,prevMonth)+"-"+new Date(Date.UTC(prevYear-1,prevMonth,0)).getUTCDate()},
  {id:"twoYears",from:monthOf(prevYear-2,prevMonth)+"-01",
   to:monthOf(prevYear-2,prevMonth)+"-"+new Date(Date.UTC(prevYear-2,prevMonth,0)).getUTCDate()},
  {id:"currentMonth",from:monthOf(y,m)+"-01",to:today}
 ];
 report.periods=periods.map(p=>({id:p.id,from:p.from,to:p.to}));
 const context={client:{slug:"ampedia",schema},allowedPharmacyIds:pharmacyIds};
 const chunks=[];for(let i=0;i<codes.length;i+=100)chunks.push(codes.slice(i,i+100));
 const byPeriod=Object.fromEntries(periods.map(p=>[p.id,{}]));
 const apiAmounts=Object.fromEntries(periods.map(p=>[p.id,{}]));
 const startTime=Date.now();let next=0;
 await Promise.all(Array.from({length:2},async()=>{
  while(next<chunks.length){
   const i=next++,r=await request({cns:chunks[i],pharmacyIds,periods},context);
   for(const p of periods){
    for(const [id,n] of Object.entries(r.periods[p.id]||{}))
     byPeriod[p.id][id]=(byPeriod[p.id][id]||0)+Number(n);
    for(const [id,n] of Object.entries(r.amounts[p.id]||{}))
     apiAmounts[p.id][id]=(apiAmounts[p.id][id]||0)+Number(n);
   }
  }
 }));
 report.apiElapsedMs=Date.now()-startTime;
 const mappedKeys=[...internal];
 const independent={},mismatches=[];
 for(const p of periods){
  // SQL de contrastación por período sin lotes, sin la preselección
  // global de articleIds de la consulta productiva. Cuenta líneas y
  // artículos realmente vendidos además de las unidades netas.
  const {rows:direct}=await pool.query({text:
   "SELECT f.id::text AS pharmacy_id,"+
   " coalesce(sum(v.unidades),0)::float8 AS net_units,"+
   " coalesce(sum(v.importe),0)::float8 AS net_amount,"+
   " count(*)::int AS lines,"+
   " count(DISTINCT btrim(v.articulo_id::text))::int AS sold_article_keys,"+
   " coalesce(sum(v.unidades) FILTER (WHERE v.unidades>0),0)::float8 AS gross_positive_units,"+
   " coalesce(sum(v.unidades) FILTER (WHERE v.unidades<0),0)::float8 AS returned_units"+
   " FROM \""+schema+"\".fm_ventas_analitica v"+
   " JOIN farmetrica.farmacias f ON f.cliente_slug=$1 "+
   " AND upper(btrim(v.farmacia_codigo::text))="+pharmacyDataCodeSQL("f")+
   " WHERE f.id=ANY($2::int[])"+
   " AND v.fecha >= $3::date AND v.fecha < ($4::date+interval '1 day')"+
   " AND (btrim(v.articulo_id::text)=ANY($5::text[])"+
   " OR f.id::text||'|'||btrim(v.articulo_id::text)=ANY($6::text[]))"+
   " GROUP BY f.id",values:["ampedia",pharmacyIds,p.from,p.to,codes,mappedKeys],
   query_timeout:30000});
  const rawUnits=Object.fromEntries(direct.map(r=>[r.pharmacy_id,Number(r.net_units)]));
  const rawAmount=Object.fromEntries(direct.map(r=>[r.pharmacy_id,Number(r.net_amount)]));
  const ids=new Set([...Object.keys(rawUnits),...Object.keys(byPeriod[p.id])]);
  const match=[...ids].every(id=>same(rawUnits[id]||0,byPeriod[p.id][id]||0)&&
    same(rawAmount[id]||0,apiAmounts[p.id][id]||0));
  if(!match)mismatches.push(p.id);
  independent[p.id]={
   apiNetUnits:sumMap(byPeriod[p.id]),sqlNetUnits:sumMap(rawUnits),
   apiNetAmount:Math.round(sumMap(apiAmounts[p.id])*100)/100,
   sqlNetAmount:Math.round(sumMap(rawAmount)*100)/100,
   matchedSalesLines:direct.reduce((a,b)=>a+Number(b.lines),0),
   soldArticleKeysAcrossPharmacies:direct.reduce((a,b)=>a+Number(b.sold_article_keys),0),
   grossPositiveUnits:direct.reduce((a,b)=>a+Number(b.gross_positive_units),0),
   returnedUnits:direct.reduce((a,b)=>a+Number(b.returned_units),0),
   apiVsSqlMatch:match
  };
 }
 report.history=independent;
 report.mismatchedPeriods=mismatches;
 console.log("PROMOTION_267_HISTORY_AUDIT",JSON.stringify(report));
 if(mismatches.length)process.exitCode=2;
}catch(error){
 console.error("PROMOTION_267_HISTORY_ERROR",JSON.stringify({reason:String(error.message||error).slice(0,200),
  code:error.code||error.name}));
 process.exitCode=1;
}finally{await pool.end();}
