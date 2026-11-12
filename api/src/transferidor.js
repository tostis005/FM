// Transferidor (solo lectura). Ninguna propuesta modifica el stock ni ejecuta movimientos.
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
import {cnCategory} from "./laboratoryOrderPlanner.js";
import {readTransferidorPolicy} from "./transferidorPolicy.js";
const SCHEMA=/^[a-z][a-z0-9_]{1,62}$/;
const SORT=new Set(["cn","name","originName","destinationName","units","stockOrigin","stockDestination","targetOrigin","targetDestination","triggerDestination","extraDestination"]);
const FILTERS=new Set(["cn","name","originName","destinationName","units","stockOrigin","stockDestination","triggerDestination","extraDestination"]);
const CAP=999999;
const asNumber=value=>Number.isFinite(Number(value))?Number(value):0;
const whole=value=>Math.max(0,Math.min(CAP,Math.ceil(asNumber(value)-1e-9)));
const identity=cn=>cnCategory(cn)==="parafarmacia"&&Number(String(cn).slice(0,6))>=1;
const stable=(a,b)=>String(a).localeCompare(String(b),"es",{numeric:true});

// El plan se calcula de una vez, antes de filtrar o paginar. Cada donante
// dispone de un saldo restante que se reduce tras CADA propuesta: no hay doble asignación.
// Sin parámetro: política nueva de transferencias 4/7.
// Se conserva el argumento numérico histórico para pruebas y clientes antiguos.
export function buildGlobalTransfers(rows,pharmacies,policy={minDays:4,targetDays:7,families:[],articles:[]}){
 const config=typeof policy==="number"?{minDays:policy,targetDays:policy,families:[],articles:[]}:
  {minDays:Number(policy?.minDays??4),targetDays:Number(policy?.targetDays??7),
   families:policy?.families||[],articles:policy?.articles||[]};
 const familyReserve=new Map(config.families.map(x=>[String(x.pharmacyId)+"|"+String(x.familyId),Number(x.days)]));
 const articleReserve=new Map(config.articles.map(x=>[String(x.pharmacyId)+"|"+String(x.cn),Number(x.units)]));
 const validSites=new Map(pharmacies.map(p=>[String(p.id),p]));
 const products=new Map();
 for(const r of rows||[]){
  const id=String(r.pharmacyId||""),rawCN=String(r.cn||"").trim();
  if(!validSites.has(id)||!identity(rawCN))continue;
  const cn=rawCN.slice(0,6);
  if(!products.has(cn))products.set(cn,{cn,name:String(r.name||cn),sites:new Map()});
  const group=products.get(cn);
  if(!group.sites.has(id))group.sites.set(id,r);
 }
 const transfers=[];let skipped=0,withNeed=0,withSurplus=0;
 for(const product of products.values()){
  const sites=[...validSites.values()].map(p=>{
   const src=product.sites.get(String(p.id));
   const rawStock=src?.stock;
   // Stock sin informar: cero. Solo se descartan valores corruptos.
   if(rawStock!=null&&(!Number.isFinite(Number(rawStock))||Number(rawStock)<0))
    return {invalid:true};
   const stock=rawStock==null?0:Math.max(0,Number(rawStock));
   const sold7=Math.max(0,asNumber(src?.units7));
   const sold3=Math.max(0,asNumber(src?.units3));
   const sold12=Math.max(0,asNumber(src?.units12));
   // Los datos nuevos del Transferidor usan solo siete días; las métricas
   // históricas se admiten como respaldo para clientes/tests antiguos.
   const daily=src?.units7!=null?sold7/7:Math.max(sold3/90,sold12/365);
   const id=String(p.id),familyId=String(src?.familyId||"");
   const byArticle=articleReserve.get(id+"|"+product.cn);
   const byFamily=familyReserve.get(id+"|"+familyId);
   // La reserva de CN sustituye la reserva de familia, no se suma dos veces.
   const extra=byArticle!=null?whole(byArticle):byFamily!=null?whole(daily*byFamily):0;
   const source=byArticle!=null?"articulo":byFamily!=null?"familia":"global";
   const threshold=whole(daily*config.minDays)+extra;
   const target=whole(daily*config.targetDays)+extra;
   const ordered=Math.max(0,asNumber(src?.ordered));
   // No se transfiere mientras se conserve el mínimo de rotación + exposición.
   const need=stock+ordered<threshold?whole(target-stock-ordered):0;
   // Nunca desvestir un expositor donante ni agotar sus 7 días de rotación.
   const surplus=Math.max(0,Math.floor(stock-target+1e-9));
   return {id,name:p.name||id,stock,target,threshold,extra,source,ordered,need,surplus,
    stockAt:src?.stockAt||null};
  });
  if(sites.some(s=>s.invalid)){skipped++;continue;}
  if(sites.some(s=>s.need>0))withNeed++;
  if(sites.some(s=>s.surplus>0))withSurplus++;
  const sources=sites.filter(s=>s.surplus>0).sort((a,b)=>b.surplus-a.surplus||stable(a.id,b.id));
  const targets=sites.filter(s=>s.need>0).sort((a,b)=>b.need-a.need||stable(a.id,b.id));
  for(const target of targets){
   let pending=target.need;
   for(const source of sources){
    if(!pending)break;
    const units=Math.min(pending,source.surplus);
    if(!units||source.id===target.id)continue;
    transfers.push({id:product.cn+":"+source.id+":"+target.id,cn:product.cn,
     name:product.name,originId:source.id,originName:source.name,
     destinationId:target.id,destinationName:target.name,units,
     stockOrigin:source.stock,targetOrigin:source.target,
     stockDestination:target.stock,targetDestination:target.target,
     triggerDestination:target.threshold,extraDestination:target.extra,
     reserveSource:target.source,minDays:config.minDays,targetDays:config.targetDays,
     stockAt:source.stockAt&&target.stockAt?
      (source.stockAt<target.stockAt?source.stockAt:target.stockAt):source.stockAt||target.stockAt});
    source.surplus-=units;pending-=units;
   }
  }
 }
 return {transfers,skipped,products:products.size,withNeed,withSurplus};
}
export function parseTransferFilters(query={},pharmacies=[]){
 const allowed=new Set(pharmacies.map(p=>String(p.id)));
 const vista=String(query.vista||"todos");
 const pharmacy=String(query.farmacia||""),origin=String(query.origen||""),destination=String(query.destino||"");
 const sort=String(query.orden||"units"),direction=String(query.direccion||"desc");
 const page=Number(query.pagina||1),size=Number(query.tamano||50);
 const search=String(query.buscar||"").trim();
 let filters={};
 try{filters=typeof query.filtros==="string"?JSON.parse(query.filtros):{};}catch{throw Error("Filtros de columnas incorrectos");}
 if(!["todos","envio","recibo"].includes(vista)||
  [pharmacy,origin,destination].some(x=>x&&!allowed.has(x))||
  !SORT.has(sort)||!["asc","desc"].includes(direction)||
  !Number.isSafeInteger(page)||page<1||page>100000||![10,25,50,100].includes(size)||
  search.length>100||typeof filters!=="object"||!filters||Array.isArray(filters)||
  Object.entries(filters).some(([k,v])=>!FILTERS.has(k)||typeof v!=="string"||v.length>100))
  throw Error("Revisa los filtros, la farmacia o la paginación");
 return {vista,pharmacy,origin,destination,sort,direction,page,size,search,filters};
}
export function filterTransferPlan(plan,options){
 const norm=x=>String(x??"").toLocaleLowerCase("es");
 const text=norm(options.search);
 const result=plan.filter(r=>{
  if(options.vista==="envio"&&options.pharmacy&&r.originId!==options.pharmacy)return false;
  if(options.vista==="recibo"&&options.pharmacy&&r.destinationId!==options.pharmacy)return false;
  if(options.vista==="todos"&&options.pharmacy&&r.originId!==options.pharmacy&&r.destinationId!==options.pharmacy)return false;
  if(options.origin&&options.origin!==r.originId)return false;
  if(options.destination&&options.destination!==r.destinationId)return false;
  if(text&&!norm([r.cn,r.name,r.originName,r.destinationName].join(" ")).includes(text))return false;
  return Object.entries(options.filters).every(([key,filter])=>!filter||norm(r[key]).includes(norm(filter)));
 });
 const factor=options.direction==="asc"?1:-1;
 result.sort((a,b)=>{
  const x=a[options.sort],y=b[options.sort];
  const cmp=typeof x==="number"&&typeof y==="number"?x-y:stable(x,y);
  return factor*cmp||stable(a.cn,b.cn)||stable(a.originId,b.originId)||stable(a.destinationId,b.destinationId);
 });
 return {rows:result.slice((options.page-1)*options.size,options.page*options.size),
  total:result.length,units:result.reduce((sum,r)=>sum+r.units,0)};
}
// Identidad entre farmacias por CN comercial. Ventas y pedidos usan el IdArticu local.
// El dígito de control se elimina y, sin CN válido, se usa el código ERP.
// El inventario y las ventas se consultan por separado: no hacer el JOIN
// de un año de documentos con todo el catálogo en cada visita.
export function transferidorInventorySQL(schema){
 const q='"'+schema+'"',code=pharmacyDataCodeSQL("f");
 const cn=`(CASE
  WHEN btrim(coalesce(a.codigo_nacional,''))~'^[0-9]{6,7}$'
   THEN left(btrim(a.codigo_nacional),6)
  WHEN btrim(a.origen_id::text)~'^[0-9]{6,7}$'
   THEN left(btrim(a.origen_id::text),6)
  ELSE NULL END)`;
 return `WITH chosen AS MATERIALIZED (
 SELECT f.id,${code} AS source_code
 FROM farmetrica.farmacias f
 WHERE f.cliente_slug=$1 AND f.id=ANY($2::int[]) AND f.activo=true
  AND coalesce(to_jsonb(f)->>'tipo_establecimiento','farmacia')='farmacia'
), catalog AS MATERIALIZED (
 SELECT f.id AS fid,f.source_code,a.origen_id::text AS article_id,
  ${cn} AS cn,a.nombre,a.stock_actual::float8 AS stock,
  a.sincronizado_en AS stock_at
 FROM chosen f JOIN ${q}.articulos a
  ON upper(btrim(a.farmacia_codigo))=f.source_code
 WHERE ${cn}::int BETWEEN 1 AND 399999
), donors AS MATERIALIZED (
 SELECT DISTINCT cn FROM catalog WHERE stock>0
)
SELECT a.fid::text AS "pharmacyId",a.source_code AS "sourceCode",
 a.article_id AS "articleId",a.cn,a.nombre AS name,a.stock,a.stock_at AS "stockAt",
 g.familia_id::text AS "familyId"
FROM catalog a JOIN donors d ON d.cn=a.cn
LEFT JOIN farmetrica.familias_globales_articulos g ON g.cliente_slug=$1
 AND g.farmacia_codigo=a.source_code AND g.articulo_origen_id=a.article_id`;
}
// Ventas de la última semana: máximo siete días de documentos para prever 4/7.
// Cada lote contiene CN completos (todas las farmacias) para no duplicar stock.
export function transferidorSalesSQL(schema){
 const q='"'+schema+'"';
 return `WITH refs AS MATERIALIZED (
 SELECT DISTINCT fid,source_code,article_id
 FROM jsonb_to_recordset($1::jsonb)
  AS r(fid text,source_code text,article_id text)
)
SELECT r.fid AS "pharmacyId",r.article_id AS "articleId",
 coalesce(sum(CASE WHEN l.devuelta THEN -abs(l.cantidad) ELSE l.cantidad END),0)::float8 AS "units7"
FROM refs r
JOIN ${q}.fm_ventas_lineas l ON l.farmacia_codigo=r.source_code
 AND l.articulo_origen_id=r.article_id
 AND NOT l.eliminada_logicamente AND coalesce(l.anulada,false)=false
JOIN ${q}.fm_ventas_cabeceras h ON h.farmacia_codigo=l.farmacia_codigo
 AND h.sistema_origen=l.sistema_origen AND h.documento_id=l.documento_id
 AND h.lineas_completas AND NOT h.eliminado_logicamente
 AND lower(btrim(h.estado)) NOT IN ('anulado','anulada','cancelado','cancelada','void')
 AND h.fecha>=(now() AT TIME ZONE 'Europe/Madrid')::date-interval '6 days'
 AND h.fecha<(now() AT TIME ZONE 'Europe/Madrid')::date+interval '1 day'
GROUP BY r.fid,r.article_id`;
}
function transferidorPendingSQL(){
 return `SELECT p.farmacia_id::text AS "pharmacyId",
 l.line->>'articulo' AS "articleId",
 coalesce(sum((assignment.item->>'unidades')::float8),0)::float8 AS ordered
FROM farmetrica.op_pedidos p
CROSS JOIN LATERAL jsonb_array_elements(coalesce(p.lineas,'[]'::jsonb)) AS l(line)
CROSS JOIN LATERAL jsonb_array_elements(coalesce(l.line->'asignaciones','[]'::jsonb)) AS assignment(item)
WHERE p.cliente_slug=$1 AND p.farmacia_id=ANY($2::int[])
 AND p.estado IN ('borrador','pendiente_aprobacion','aprobado','exportado')
GROUP BY p.farmacia_id,l.line->>'articulo'`;
}
export function transferidorCNChunks(rows,maxArticles=700){
 const groups=new Map();
 for(const r of rows){
  const key=String(r.cn||"");
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push(r);
 }
 // Stock más desigual entre farmacias primero: propuestas visibles antes.
 const sorted=[...groups.values()].sort((a,b)=>{
  const imbalance=items=>Math.max(...items.map(x=>Number(x.stock)||0));
  return imbalance(b)-imbalance(a);
 });
 const chunks=[];let current=[];
 for(const entries of sorted){
  if(current.length&&current.length+entries.length>maxArticles){
   chunks.push(current);current=[];
  }
  current.push(...entries);
 }
 if(current.length)chunks.push(current);
 return chunks;
}
async function readTransferInventory(pool,schema,slug,ids){
 const request={text:transferidorInventorySQL(schema),values:[slug,ids],query_timeout:65000};
 // Un cliente PG ya adquirido por el llamador (integración) no se reconecta.
 if(typeof pool.connect!=="function"||typeof pool.release==="function")
  return (await pool.query(request)).rows;
 const db=await pool.connect();
 try{
  await db.query("BEGIN READ ONLY");
  await db.query("SET LOCAL statement_timeout='60s'");
  const {rows}=await db.query(request);
  await db.query("COMMIT");
  return rows;
 }catch(e){await db.query("ROLLBACK").catch(()=>{});throw e}
 finally{db.release()}
}
async function readTransferSales(pool,schema,entries){
 const refs=entries.map(r=>({fid:String(r.pharmacyId),
  source_code:String(r.sourceCode),article_id:String(r.articleId)}));
 const {rows}=await pool.query({text:transferidorSalesSQL(schema),
  values:[JSON.stringify(refs)],query_timeout:20000});
 return rows;
}
export function mergeTransferBatch(entries,metrics,pending){
 const byArticle=new Map(metrics.map(m=>[String(m.pharmacyId)+"|"+String(m.articleId),m]));
 const joined=new Map();
 for(const entry of entries){
  const fid=String(entry.pharmacyId),article=String(entry.articleId);
  const key=String(entry.cn)+"|"+fid;
  const sold=byArticle.get(fid+"|"+article);
  if(!joined.has(key))joined.set(key,{
   cn:String(entry.cn),pharmacyId:fid,name:String(entry.name||entry.cn),
   familyId:entry.familyId||null,stock:0,units7:0,ordered:0,stockAt:entry.stockAt||null
  });
  const item=joined.get(key);
  item.stock+=Math.max(0,Number(entry.stock)||0);
  item.units7+=Number(sold?.units7)||0;
  item.ordered+=Number(pending.get(fid+"|"+article))||0;
  if(!item.familyId&&entry.familyId)item.familyId=entry.familyId;
 }
 return [...joined.values()];
}
const TRANSFER_TTL=10*60*1000;
const transferJobs=new Map();
const transferQueue=[];
let activeTransferJobs=0;
function queueTransferJob(job,task){
 transferQueue.push({job,task});
 while(activeTransferJobs<2&&transferQueue.length){
  const next=transferQueue.shift();
  activeTransferJobs++;
  void next.task().catch(e=>{
   next.job.status="error";next.job.error="No se pudo calcular el Transferidor.";
   console.error("TRANSFERIDOR_FALLO",e.code||e.name);
  }).finally(()=>{activeTransferJobs--;pumpTransferQueue()});
 }
}
function pumpTransferQueue(){
 if(activeTransferJobs>=2||!transferQueue.length)return;
 const next=transferQueue.shift();
 activeTransferJobs++;
 void next.task().catch(e=>{
  next.job.status="error";next.job.error="No se pudo calcular el Transferidor.";
  console.error("TRANSFERIDOR_FALLO",e.code||e.name);
 }).finally(()=>{activeTransferJobs--;pumpTransferQueue()});
}
function splitTransferCN(entries){
 const groups=transferidorCNChunks(entries,Math.ceil(entries.length/2));
 if(groups.length>1)return [groups[0],groups.slice(1).flat()];
 return null;
}
async function transferBatch(pool,schema,entries,pharmacies,policy,pending,job){
 try{
  const sales=await readTransferSales(pool,schema,entries);
  const plan=buildGlobalTransfers(mergeTransferBatch(entries,sales,pending),pharmacies,policy);
  job.plan.transfers.push(...plan.transfers);
  for(const field of ["skipped","products","withNeed","withSurplus"])
   job.plan[field]+=plan[field];
  job.progress.done++;
 }catch(e){
  if((["57014","53300"].includes(e.code)||e.message==="Query read timeout")){
   const parts=entries.length>25?splitTransferCN(entries):null;
   if(parts){
    job.progress.total++;
    await transferBatch(pool,schema,parts[0],pharmacies,policy,pending,job);
    await transferBatch(pool,schema,parts[1],pharmacies,policy,pending,job);
   }else{
    job.failed+=new Set(entries.map(x=>x.cn)).size;
    job.progress.done++;
   }
   return;
  }
  throw e;
 }
}
async function runTransferJob(pool,schema,slug,ids,pharmacies,job){
 const started=Date.now();
 try{
  job.status="inventory";
  const [inventory,policy,{rows:pendingRows}]=await Promise.all([
   readTransferInventory(pool,schema,slug,ids),
   readTransferidorPolicy(pool,slug,ids),
   pool.query({text:transferidorPendingSQL(),values:[slug,ids],query_timeout:15000})
  ]);
  const seen=new Set(inventory.map(r=>String(r.pharmacyId)));
  job.missing=pharmacies.filter(p=>!seen.has(String(p.id)));
  if(seen.size<2){
   job.status="complete";job.available=false;
   job.warning="No hay dos farmacias con inventario sincronizado para comparar.";
   return;
  }
  const pending=new Map(pendingRows.map(r=>[String(r.pharmacyId)+"|"+String(r.articleId),r.ordered]));
  const chunks=transferidorCNChunks(inventory);
  job.progress={done:0,total:chunks.length};
  job.policy=policy;
  job.analyzed= new Set(inventory.map(r=>r.cn)).size;
  job.status="calculating";
  for(const entries of chunks)
   await transferBatch(pool,schema,entries,pharmacies,policy,pending,job);
  job.status=job.failed?"partial":"complete";
  if(job.failed&&!job.plan.products){
   job.status="error";
   job.error="No se han podido recuperar las ventas. Revisa la sincronización o los índices de ventas.";
  }
  console.info("TRANSFERIDOR_LOTES",JSON.stringify({
   status:job.status,elapsedMs:Date.now()-started,
   products:job.plan.products,proposals:job.plan.transfers.length,failed:job.failed
  }));
 }catch(e){
  job.status="error";
  job.error=["42P01","42703"].includes(e.code)?
   "Faltan datos de artículos o ventas. Revisa la sincronización.":
   ["57014","53300"].includes(e.code)||e.message==="Query read timeout"?
   "La consulta ha agotado el tiempo disponible. Revisa los índices de artículos y ventas.":
   "No se pudo calcular el Transferidor.";
  console.error("TRANSFERIDOR_JOB",JSON.stringify({code:e.code||e.name||"QUERY_ERROR"}));
 }finally{job.expires=Date.now()+TRANSFER_TTL}
}
function getTransferJob(pool,schema,slug,pharmacies,forceToken=""){
 const ids=pharmacies.map(p=>Number(p.id)).sort((a,b)=>a-b);
 const key=[slug,schema,ids.join(","),forceToken].join("|");
 const now=Date.now(),current=transferJobs.get(key);
 if(current&&(current.expires===0||current.expires>now))return current;
 const job={status:"queued",available:true,plan:{transfers:[],
  skipped:0,products:0,withNeed:0,withSurplus:0},progress:{done:0,total:0},
  policy:{minDays:4,targetDays:7},failed:0,warning:"",missing:[],analyzed:0,
  createdAt:now,expires:0,error:""};
 transferJobs.set(key,job);
 if(transferJobs.size>20){
  for(const [k,v] of transferJobs){
   if(k!==key&&v.expires&&v.expires<now)transferJobs.delete(k);
  }
 }
 queueTransferJob(job,()=>runTransferJob(pool,schema,slug,ids,pharmacies,job));
 return job;
}
export function setupTransferidor(app,pool,{requireTenant}){
 app.get("/api/analytics/stock/transferidor",...requireTenant(),async(req,res,next)=>{
  const ctx=req.context;
  const pharmacies=(ctx.pharmacies||[]).filter(p=>p.active!==false&&p.establishmentType!=="almacen");
  if(ctx.role!=="superadministrador"&&ctx.modules?.stock!==true)
   return res.status(403).json({error:"Stock no habilitado"});
  let opts;
  try{opts=parseTransferFilters(req.query,pharmacies)}
  catch(e){return res.status(400).json({error:e.message})}
  const schema=ctx.client?.schema;
  if(!SCHEMA.test(schema||""))return res.status(400).json({error:"Cliente no válido"});
  if(pharmacies.length<2)return res.json({available:false,status:"complete",
   rows:[],total:0,summary:{movements:0,units:0,products:0},
   warning:"Se necesitan dos farmacias para comparar."});
  try{
   const job=getTransferJob(pool,schema,ctx.client.slug,pharmacies,String(req.query.recalcular||""));
   if(job.status==="error")return res.status(503).json({status:"error",error:job.error});
   const plan=job.plan,filtered=filterTransferPlan(plan.transfers,opts);
   const pending=["queued","inventory","calculating"].includes(job.status);
   const emptyReason=pending?null:!plan.products?"No hay referencias con stock y ventas para redistribuir.":
    !plan.withSurplus?"No hay excedentes disponibles.":
    !plan.withNeed?"No hay necesidades por debajo del mínimo configurado.":
    !plan.transfers.length?"No coinciden excedentes y necesidades del mismo artículo.":null;
   const warning=[job.warning,job.missing.length?
    "Sin inventario en "+job.missing.map(p=>p.name).join(", "):"",
    job.failed?"No se han podido analizar "+job.failed+" CN. Reintenta la carga.":""].filter(Boolean).join(". ")||null;
   res.json({status:job.status,available:job.available,rows:filtered.rows,total:filtered.total,
    page:opts.page,pageSize:opts.size,progress:job.progress,
    emptyReason,summary:{movements:plan.transfers.length,
     units:plan.transfers.reduce((sum,r)=>sum+r.units,0),
     filteredUnits:filtered.units,
     products:new Set(plan.transfers.map(r=>r.cn)).size,
     analyzed:plan.products,minimumDays:job.policy.minDays,
     targetDays:job.policy.targetDays,
     withNeed:plan.withNeed,withSurplus:plan.withSurplus,skipped:plan.skipped},
    calculatedAt:pending?null:new Date(job.createdAt).toISOString(),warning});
  }catch(e){next(e)}
 });
}
