// Transferidor (solo lectura). Ninguna propuesta modifica el stock ni ejecuta movimientos.
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
import {cnCategory} from "./laboratoryOrderPlanner.js";
import {readTransferidorPolicy} from "./transferidorPolicy.js";
const SCHEMA=/^[a-z][a-z0-9_]{1,62}$/;
const SORT=new Set(["cn","name","originName","destinationName","units","stockOrigin","stockDestination","targetOrigin","targetDestination","triggerDestination","extraDestination","sales7Origin","sales7Destination","sales30Origin","sales30Destination"]);
const FILTERS=new Set(["cn","name","originName","destinationName","units","stockOrigin","stockDestination","triggerDestination","extraDestination","sales7Origin","sales7Destination","sales30Origin","sales30Destination"]);
const CAP=999999;
const asNumber=value=>Number.isFinite(Number(value))?Number(value):0;
const whole=value=>Math.max(0,Math.min(CAP,Math.ceil(asNumber(value)-1e-9)));
const identity=cn=>cnCategory(cn)==="parafarmacia"&&Number(String(cn).slice(0,6))>=1;
const stable=(a,b)=>String(a).localeCompare(String(b),"es",{numeric:true});

// Combina tendencias de 7 y 30 días, conservando más peso de la semana
// cuando acelera y más peso del mes cuando la semana se enfría.
export function transferidorDemandForecast(src={}){
 const legacy=Math.max(0,asNumber(src?.units3))/90||
  Math.max(0,asNumber(src?.units12))/365;
 const week=src?.units7==null?null:Math.max(0,asNumber(src.units7))/7;
 const month=src?.units30==null?null:Math.max(0,asNumber(src.units30))/30;
 const recent=week??month??legacy,history=month??week??legacy;
 const high=Math.max(recent,history),low=Math.min(recent,history);
 const blended=recent>=history?
  history+(recent-history)*0.75:
  recent+(history-recent)*0.70;
 return {recent,history,high,low,blended};
}

// Reparto proporcional a los días de cobertura: cuando no alcanza el stock,
// igualar primero las farmacias menos cubiertas antes de completar una sola.
export function transferidorFairQuotas(targets,budget,goal){
 const states=targets.map(site=>{
  const current=site.stock+site.received;
  const need=whole(site[goal]-current);
  return {site,need,current,rate:Math.max(1e-9,site.forecast.blended),
   quota:0};
 }).filter(s=>s.need>0);
 const available=Math.min(Math.max(0,Math.floor(budget)),states.reduce((n,s)=>n+s.need,0));
 if(!available)return new Map();
 if(available===states.reduce((n,s)=>n+s.need,0))
  return new Map(states.map(x=>[x.site.id,x.need]));
 let lower=Math.min(...states.map(s=>(s.current-s.site.extra)/s.rate));
 let upper=Math.max(...states.map(s=>(s.site[goal]-s.site.extra)/s.rate));
 for(let iteration=0;iteration<36;iteration++){
  const level=(lower+upper)/2;
  const demand=states.reduce((n,s)=>n+Math.min(s.need,
   Math.max(0,level*s.rate+s.site.extra-s.current)),0);
  if(demand>available)upper=level;
  else lower=level;
 }
 for(const s of states)
  s.quota=Math.min(s.need,Math.max(0,Math.floor(lower*s.rate+s.site.extra-s.current+1e-9)));
 let left=available-states.reduce((n,s)=>n+s.quota,0);
 while(left>0){
  const eligible=states.filter(s=>s.quota<s.need);
  if(!eligible.length)break;
  eligible.sort((a,b)=>(a.current+a.quota-a.site.extra)/a.rate-
   (b.current+b.quota-b.site.extra)/b.rate||stable(a.site.id,b.site.id));
  eligible[0].quota++;left--;
 }
 return new Map(states.map(s=>[s.site.id,s.quota]));
}

// El plan siempre se calcula globalmente antes de aplicar filtros y paginar.
// Cada CN se trata por separado; las transferencias reducen el saldo del donante.
// Nunca se usan pedidos de reposición inciertos como stock disponible.
export function buildGlobalTransfers(rows,pharmacies,policy={minDays:4,targetDays:7,families:[],articles:[]}){
 const config=typeof policy==="number"?
  {minDays:policy,targetDays:policy,families:[],articles:[],webPendingByCn:new Map()}:
  {minDays:Number(policy?.minDays??4),targetDays:Number(policy?.targetDays??7),
   families:policy?.families||[],articles:policy?.articles||[],
   webPendingByCn:policy?.webPendingByCn||new Map()};
 const familyReserve=new Map(config.families.map(x=>
  [String(x.pharmacyId)+"|"+String(x.familyId),Number(x.days)]));
 const articleReserve=new Map(config.articles.map(x=>
  [String(x.pharmacyId)+"|"+String(x.cn),Number(x.units)]));
 const validSites=new Map(pharmacies.map(p=>[String(p.id),p]));
 const webPending=config.webPendingByCn instanceof Map?config.webPendingByCn:
  new Map(Object.entries(config.webPendingByCn||{}));
 const products=new Map();
 for(const row of rows||[]){
  const id=String(row.pharmacyId||""),raw=String(row.cn||"").trim();
  if(!validSites.has(id)||!identity(raw))continue;
  const cn=raw.slice(0,6);
  if(!products.has(cn))products.set(cn,{cn,name:String(row.name||cn),sites:new Map()});
  const product=products.get(cn);
  if(!product.sites.has(id))product.sites.set(id,row);
 }
 const transfers=[];let skipped=0,withNeed=0,withSurplus=0;
 for(const product of products.values()){
  const sites=[...validSites.values()].map(pharmacy=>{
   const src=product.sites.get(String(pharmacy.id));
   const rawStock=src?.stock;
   if(rawStock!=null&&(!Number.isFinite(Number(rawStock))||Number(rawStock)<0))
    return {invalid:true};
   const stock=rawStock==null?0:Math.max(0,Number(rawStock));
   const forecast=transferidorDemandForecast(src);
   const id=String(pharmacy.id),familyId=String(src?.familyId||"");
   const isWarehouse=pharmacy.establishmentType==="almacen"||pharmacy.kind==="almacen";
   const article=articleReserve.get(id+"|"+product.cn);
   const family=familyReserve.get(id+"|"+familyId);
   const extra=article!=null?whole(article):family!=null?whole(forecast.blended*family):0;
   const reserveSource=article!=null?"articulo":family!=null?"familia":"global";
   const highTarget=whole(forecast.high*config.targetDays)+extra;
   const baseTarget=whole(forecast.blended*config.targetDays)+extra;
   const lowTarget=whole(forecast.low*config.targetDays)+extra;
   const threshold=whole(forecast.high*config.minDays);
   const safetyFloor=whole(forecast.high*config.minDays)+extra;
   const need=!isWarehouse&&forecast.high>0&&stock<threshold;
   return {id,name:pharmacy.name||id,stock,remaining:stock,received:0,
    forecast,extra,reserveSource,highTarget,baseTarget,lowTarget,
    safetyFloor,threshold,need,isWarehouse,
    visible7:src?.units7==null?null:asNumber(src.units7),
    visible30:src?.units30==null?null:asNumber(src.units30),
    stockAt:src?.stockAt||null};
  });
  if(sites.some(site=>site.invalid)){skipped++;continue;}
  const retail=sites.filter(site=>!site.isWarehouse);
  const warehouse=sites.find(site=>site.isWarehouse);
  if(warehouse){
   // Las ventas minoristas no son salidas directas del almacén.
   const busiest=Math.max(0,...retail.map(site=>site.forecast.high));
   const webDaily=warehouse.forecast.high;
   const backlog=whole(webPending.get(product.cn)||0);
   const webProjection=whole(webDaily*config.targetDays);
   const webProxy=webDaily===0?whole(busiest*config.targetDays):0;
   const webReserve=Math.max(webProjection,backlog,webProxy);
   const replenishmentReserve=whole(busiest*config.minDays);
   warehouse.safetyFloor=webReserve+replenishmentReserve;
   warehouse.highTarget=warehouse.safetyFloor;
   warehouse.baseTarget=warehouse.safetyFloor;
   warehouse.lowTarget=warehouse.safetyFloor;
   warehouse.webReserve=webReserve;
   warehouse.replenishmentReserve=replenishmentReserve;
   warehouse.webEstimate=webProxy>Math.max(webProjection,backlog);
  }
  const targets=retail.filter(site=>site.need);
  if(targets.length)withNeed++;
  if(sites.some(site=>site.remaining>site.safetyFloor))withSurplus++;
  if(!targets.length)continue;
  const donors=sites.filter(site=>!site.need);
  const movements=new Map();
  const cover=site=>{
   if(site.forecast.blended<=0)return Infinity;
   return Math.max(0,site.remaining+site.received-site.extra)/site.forecast.blended;
  };
  const donorOrder=(a,b)=>
   Number(b.isWarehouse)-Number(a.isWarehouse)||cover(b)-cover(a)||stable(a.id,b.id);
  const targetOrder=(a,b)=>cover(a)-cover(b)||stable(a.id,b.id);
  function move(source,target,units){
   if(units<=0||source.id===target.id)return;
   source.remaining-=units;target.received+=units;
   const id=product.cn+":"+source.id+":"+target.id;
   if(movements.has(id)){movements.get(id).units+=units;return;}
   movements.set(id,{id,cn:product.cn,name:product.name,
    originId:source.id,originName:source.name,
    destinationId:target.id,destinationName:target.name,units,
    originKind:source.isWarehouse?"almacen":"farmacia",
    stockOrigin:source.stock,targetOrigin:source.safetyFloor,
    originIdealTarget:source.highTarget,
    warehouseWebReserve:source.isWarehouse?source.webReserve:null,
    warehousePharmacyReserve:source.isWarehouse?source.replenishmentReserve:null,
    warehouseWebEstimate:source.isWarehouse?source.webEstimate:null,
    sales7Origin:source.visible7,sales30Origin:source.visible30,
    stockDestination:target.stock,
    sales7Destination:target.visible7,sales30Destination:target.visible30,
    targetDestination:target.highTarget,
    balancedTargetDestination:target.baseTarget,
    lowTargetDestination:target.lowTarget,
    triggerDestination:target.threshold,extraDestination:target.extra,
    forecastDailyDestination:target.forecast.blended,
    reserveSource:target.reserveSource,minDays:config.minDays,targetDays:config.targetDays,
    stockAt:source.stockAt&&target.stockAt?
     (source.stockAt<target.stockAt?source.stockAt:target.stockAt):
     source.stockAt||target.stockAt});
  }
  // 1) Escenario exigente, solo del excedente real sobre objetivos exigentes.
  // 2) Escenario prudente: mayor rotación entre dos períodos, pero cobertura
  // baja; 3) previsión intermedia; 4) igualar coberturas sin comprometer la
  // reserva mínima de 4 días y exposición en los orígenes.
  const steps=[
   ["high","highTarget","highTarget"],
   ["low","lowTarget","baseTarget"],
   ["medium","baseTarget","baseTarget"],
   ["balanced","baseTarget","safetyFloor"]
  ];
  for(const [tier,goal,floorKey] of steps){
   for(let round=0;round<(tier==="balanced"?targets.length+2:1);round++){
    const supply=donors.reduce((sum,source)=>
     sum+Math.floor(Math.max(0,source.remaining-source[floorKey])+1e-9),0);
    if(!supply)break;
    const quotas=transferidorFairQuotas(targets,supply,goal);
    if(!quotas.size)break;
    let changed=false;
    for(const target of targets.slice().sort(targetOrder)){
     let needed=quotas.get(target.id)||0;
     if(!needed)continue;
     for(const source of donors.slice().sort(donorOrder)){
      const canSpare=Math.floor(Math.max(0,source.remaining-source[floorKey])+1e-9);
      if(!canSpare)continue;
      let units=Math.min(canSpare,needed);
      if(tier==="balanced"&&!source.isWarehouse){
       const sourceRate=source.forecast.blended,targetRate=target.forecast.blended;
       if(sourceRate>0&&targetRate>0){
        const gap=cover(source)-cover(target);
        if(gap<=0)continue;
        units=Math.min(units,Math.floor(gap/(1/sourceRate+1/targetRate)+1e-9));
       }
      }
      if(!units)continue;
      move(source,target,units);changed=true;needed-=units;
      if(!needed)break;
     }
    }
    if(!changed||tier!=="balanced")break;
   }
  }
  transfers.push(...movements.values());
 }
 return {transfers,skipped,products:products.size,withNeed,withSurplus};
}
export function parseTransferFilters(query={},pharmacies=[]){
 const allowed=new Set(pharmacies.map(p=>String(p.id)));
 const vista=String(query.vista||"todos");
 const pharmacy=String(query.farmacia||""),origin=String(query.origen||""),destination=String(query.destino||"");
 const sort=String(query.orden||"units"),direction=String(query.direccion||"desc");
 // tamano=0 significa todas las propuestas (vista predeterminada).
 const page=Number(query.pagina??1),size=Number(query.tamano??0);
 const search=String(query.buscar||"").trim();
 let filters={};
 try{filters=typeof query.filtros==="string"?JSON.parse(query.filtros):{};}catch{throw Error("Filtros de columnas incorrectos");}
 if(!["todos","envio","recibo"].includes(vista)||
  [pharmacy,destination].some(x=>x&&!allowed.has(x))||
  (origin&&origin!=="almacen"&&!allowed.has(origin))||
  !SORT.has(sort)||!["asc","desc"].includes(direction)||
  !Number.isSafeInteger(page)||page<1||page>100000||![0,10,25,50,100,500,1000].includes(size)||
  (size===0&&page!==1)||
  search.length>100||typeof filters!=="object"||!filters||Array.isArray(filters)||
  Object.entries(filters).some(([k,v])=>!FILTERS.has(k)||typeof v!=="string"||v.length>100))
  throw Error("Revisa los filtros, la farmacia o la paginación");
 return {vista:pharmacy?vista:"todos",pharmacy,origin,destination,sort,direction,page,size,search,filters};
}
export function filterTransferPlan(plan,options){
 const norm=x=>String(x??"").toLocaleLowerCase("es");
 const text=norm(options.search);
 const result=plan.filter(r=>{
  if(options.vista==="envio"&&options.pharmacy&&r.originId!==options.pharmacy)return false;
  if(options.vista==="recibo"&&options.pharmacy&&r.destinationId!==options.pharmacy)return false;
  if(options.vista==="todos"&&options.pharmacy&&r.originId!==options.pharmacy&&r.destinationId!==options.pharmacy)return false;
  if(options.origin&&options.origin!==r.originId&&!(options.origin==="almacen"&&r.originKind==="almacen"))return false;
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
 return {rows:options.size===0?result:
  result.slice((options.page-1)*options.size,options.page*options.size),
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
 SELECT f.id,${code} AS source_code,f.nombre AS site_name,
  CASE WHEN upper(btrim(f.codigo_origen))='ALMACEN' THEN 'almacen' ELSE 'farmacia' END AS kind
 FROM farmetrica.farmacias f
 WHERE f.cliente_slug=$1 AND f.activo=true AND (
  (f.id=ANY($2::int[]) AND coalesce(to_jsonb(f)->>'tipo_establecimiento','farmacia')='farmacia')
  OR (upper(btrim(f.codigo_origen))='ALMACEN'
   AND coalesce(to_jsonb(f)->>'tipo_establecimiento','farmacia')='almacen')
 )
), catalog AS MATERIALIZED (
 SELECT f.id AS fid,f.source_code,f.site_name,f.kind,a.origen_id::text AS article_id,
  ${cn} AS cn,a.nombre,a.stock_actual::float8 AS stock,
  a.sincronizado_en AS stock_at
 FROM chosen f JOIN ${q}.articulos a
  ON upper(btrim(a.farmacia_codigo))=f.source_code
 WHERE ${cn}::int BETWEEN 1 AND 399999
), donors AS MATERIALIZED (
 SELECT DISTINCT cn FROM catalog WHERE stock>0
)
SELECT a.fid::text AS "pharmacyId",a.source_code AS "sourceCode",
 a.site_name AS "siteName",a.kind,a.article_id AS "articleId",
 a.cn,a.nombre AS name,a.stock,a.stock_at AS "stockAt",
 g.familia_id::text AS "familyId"
FROM catalog a JOIN donors d ON d.cn=a.cn
LEFT JOIN farmetrica.familias_globales_articulos g ON g.cliente_slug=$1
 AND g.farmacia_codigo=a.source_code AND g.articulo_origen_id=a.article_id`;
}
// Ventas de la última semana: máximo siete días de documentos para prever 4/7.
// Cada lote contiene CN completos (todas las farmacias) para no duplicar stock.
// Una lectura por lote: 30 días para contexto y subconjunto de 7 días
// en el mismo recorrido, filtrando cabeceras por fecha e IDs ERP locales.
export function transferidorSalesSQL(schema){
 const q='"'+schema+'"';
 return `WITH refs AS MATERIALIZED (
 SELECT DISTINCT fid,source_code,article_id
 FROM jsonb_to_recordset($1::jsonb)
  AS r(fid text,source_code text,article_id text)
)
SELECT r.fid AS "pharmacyId",r.article_id AS "articleId",
 coalesce(sum(CASE WHEN h.fecha >= (now() AT TIME ZONE 'Europe/Madrid')::date-interval '6 days'
  THEN CASE WHEN l.devuelta THEN -abs(l.cantidad) ELSE l.cantidad END
  ELSE 0 END),0)::float8 AS "units7",
 coalesce(sum(CASE WHEN l.devuelta THEN -abs(l.cantidad) ELSE l.cantidad END),0)::float8 AS "units30"
FROM refs r
JOIN ${q}.fm_ventas_lineas l ON l.farmacia_codigo=r.source_code
 AND l.articulo_origen_id=r.article_id
 AND NOT l.eliminada_logicamente AND coalesce(l.anulada,false)=false
JOIN ${q}.fm_ventas_cabeceras h ON h.farmacia_codigo=l.farmacia_codigo
 AND h.sistema_origen=l.sistema_origen AND h.documento_id=l.documento_id
 AND h.lineas_completas AND NOT h.eliminado_logicamente
 AND lower(btrim(h.estado)) NOT IN ('anulado','anulada','cancelado','cancelada','void')
 AND h.fecha >= (now() AT TIME ZONE 'Europe/Madrid')::date-interval '29 days'
 AND h.fecha < (now() AT TIME ZONE 'Europe/Madrid')::date+interval '1 day'
GROUP BY r.fid,r.article_id`;
}
// Snapshot fresco de Picking List. Si falta o caduca no se atribuyen
// pedidos ficticios: se aplica la reserva conservadora por rotación global.
export function transferidorPendingWebSQL(){
 return `SELECT left(btrim(p.cn),6) AS cn,sum(p.quantity)::float8 AS units
 FROM farmetrica.picking_list_pendientes p
 JOIN farmetrica.picking_list_fuentes f ON f.cliente_slug=p.cliente_slug
  AND f.ultima_importacion >= now()-interval '30 minutes'
 WHERE p.cliente_slug=$1 AND btrim(p.cn)~'^[0-9]{6,7}$'
 GROUP BY left(btrim(p.cn),6)`;
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
export function mergeTransferBatch(entries,metrics){
 const byArticle=new Map(metrics.map(m=>[String(m.pharmacyId)+"|"+String(m.articleId),m]));
 const joined=new Map();
 for(const entry of entries){
  const fid=String(entry.pharmacyId),article=String(entry.articleId);
  const key=String(entry.cn)+"|"+fid;
  const sold=byArticle.get(fid+"|"+article);
  if(!joined.has(key))joined.set(key,{
   cn:String(entry.cn),pharmacyId:fid,name:String(entry.name||entry.cn),
   familyId:entry.familyId||null,kind:entry.kind||"farmacia",stock:0,
   units7:0,units30:0,stockAt:entry.stockAt||null
  });
  const item=joined.get(key);
  item.stock+=Math.max(0,Number(entry.stock)||0);
  item.units7+=Number(sold?.units7)||0;
  item.units30+=Number(sold?.units30)||0;
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
async function transferBatch(pool,schema,entries,pharmacies,policy,job){
 try{
  const sales=await readTransferSales(pool,schema,entries);
  const plan=buildGlobalTransfers(mergeTransferBatch(entries,sales),pharmacies,policy);
  job.plan.transfers.push(...plan.transfers);
  for(const field of ["skipped","products","withNeed","withSurplus"])
   job.plan[field]+=plan[field];
  job.progress.done++;
 }catch(e){
  if((["57014","53300"].includes(e.code)||e.message==="Query read timeout")){
   const parts=entries.length>25?splitTransferCN(entries):null;
   if(parts){
    job.progress.total++;
    await transferBatch(pool,schema,parts[0],pharmacies,policy,job);
    await transferBatch(pool,schema,parts[1],pharmacies,policy,job);
   }else{
    job.failed+=new Set(entries.map(x=>x.cn)).size;
    job.progress.done++;
   }
   return;
  }
  throw e;
 }
}
// Un CN aparece en un único lote: no se duplica ningún saldo.
export async function processTransferChunks(chunks,run,{concurrency=2}={}){
 const workers=Math.min(Math.max(1,Math.trunc(concurrency)||1),chunks.length);
 let cursor=0;
 const outcome=await Promise.allSettled(Array.from({length:workers},async()=>{
  while(cursor<chunks.length){
   const current=chunks[cursor++];
   await run(current);
  }
 }));
 const failure=outcome.find(result=>result.status==="rejected");
 if(failure)throw failure.reason;
}
async function runTransferJob(pool,schema,slug,ids,pharmacies,job){
 const started=Date.now();
 try{
  job.status="inventory";
  const [inventory,policy,webPending]=await Promise.all([
   readTransferInventory(pool,schema,slug,ids),
   readTransferidorPolicy(pool,slug,ids),
   pool.query({text:transferidorPendingWebSQL(),values:[slug],query_timeout:8000})
    .then(result=>result.rows)
    .catch(e=>{
     console.warn("TRANSFERIDOR_PICKING_PENDIENTES",{code:e.code||e.name});
     return [];
    })
  ]);
  const seen=new Set(inventory.filter(r=>r.kind!=="almacen").map(r=>String(r.pharmacyId)));
  job.missing=pharmacies.filter(p=>!seen.has(String(p.id)));
  const whRow=inventory.find(r=>r.kind==="almacen");
  const warehouseSites=whRow?[{id:String(whRow.pharmacyId),
   name:whRow.siteName||"Almacén central",establishmentType:"almacen"}]:[];
  job.warehouseAvailable=warehouseSites.length>0;
  if(!seen.size||(!warehouseSites.length&&seen.size<2)){
   job.status="complete";
   job.warning=inventory.length?"No hay suficientes referencias comparables entre las farmacias.":
    "No hay artículos de parafarmacia con stock para redistribuir.";
   return;
  }
  const chunks=transferidorCNChunks(inventory,350);
  job.progress={done:0,total:chunks.length};
  job.policy=policy;
  const supplyPolicy={...policy,webPendingByCn:new Map(webPending.map(row=>[String(row.cn),row.units]))};
  const allSources=[...pharmacies,...warehouseSites];
  job.analyzed=new Set(inventory.map(r=>r.cn)).size;
  job.status="calculating";
  await processTransferChunks(chunks,entries=>
   transferBatch(pool,schema,entries,allSources,supplyPolicy,job),{
    concurrency:typeof pool.connect==="function"&&typeof pool.release!=="function"?2:1
   });
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
 }finally{job.finishedAt=Date.now();job.expires=Date.now()+TRANSFER_TTL}
}
function getTransferJob(pool,schema,slug,pharmacies,forceToken=""){
 const ids=pharmacies.map(p=>Number(p.id)).sort((a,b)=>a-b);
 const key=[slug,schema,ids.join(","),forceToken].join("|");
 const now=Date.now(),current=transferJobs.get(key);
 if(current&&(current.expires===0||current.expires>now))return current;
 // Un botón de refresco no debe duplicar el cálculo si todavía está activo.
 const base=[slug,schema,ids.join(",")].join("|")+"|";
 for(const [existingKey,existing] of transferJobs){
  if(existingKey.startsWith(base)&&!existing.expires)return existing;
 }
 const job={status:"queued",available:true,plan:{transfers:[],
  skipped:0,products:0,withNeed:0,withSurplus:0},progress:{done:0,total:0},
  policy:{minDays:4,targetDays:7},failed:0,
  warehouseAvailable:false,warning:"",missing:[],analyzed:0,
  createdAt:now,finishedAt:0,expires:0,error:""};
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
  if(pharmacies.length<1)return res.json({available:false,status:"complete",
   rows:[],total:0,summary:{movements:0,units:0,products:0},
   warning:"Se necesita una farmacia para calcular transferencias."});
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
    "Sin referencias comparables en "+job.missing.map(p=>p.name).join(", "):"",
    job.failed?"No se han podido analizar "+job.failed+" CN. Reintenta la carga.":"",
    ""].filter(Boolean).join(". ")||null;
   res.json({status:job.status,available:job.available,rows:filtered.rows,total:filtered.total,
    page:opts.page,pageSize:opts.size,progress:job.progress,
    elapsedMs:(job.finishedAt||Date.now())-job.createdAt,
    warehouseAvailable:job.warehouseAvailable,
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
