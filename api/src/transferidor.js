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
   const sold3=Math.max(0,asNumber(src?.units3));
   const sold12=Math.max(0,asNumber(src?.units12));
   const daily=Math.max(sold3/90,sold12/365);
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
function inventorySql(schema){
 const q='"'+schema+'"',code=pharmacyDataCodeSQL("f");
 const cn=`(CASE
  WHEN btrim(coalesce(a.codigo_nacional,''))~'^[0-9]{6}([.][0-9])?$'
   THEN left(btrim(a.codigo_nacional),6)
  WHEN btrim(coalesce(a.codigo_nacional,''))~'^[0-9]{7}$'
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
 -- Leer una sola vez el catálogo del conjunto de farmacias.
 -- El identificador comercial del CN puede ser diferente al IdArticu local.
 SELECT f.id AS fid,f.source_code,a.origen_id::text AS article_id,
  ${cn} AS cn,a.nombre,a.stock_actual::float8 AS stock,
  a.sincronizado_en AS stock_at
 FROM chosen f
 JOIN ${q}.articulos a ON upper(btrim(a.farmacia_codigo))=f.source_code
 WHERE ${cn} IS NOT NULL AND ${cn}::int BETWEEN 1 AND 399999
), candidates AS MATERIALIZED (
 -- Solo analizar productos que existen con stock positivo en alguna farmacia.
 SELECT DISTINCT cn FROM catalog WHERE stock>0
), eligible AS MATERIALIZED (
 SELECT a.*,g.familia_id AS family_id
 FROM catalog a
 JOIN candidates c ON c.cn=a.cn
 LEFT JOIN farmetrica.familias_globales_articulos g ON g.cliente_slug=$1
  AND g.farmacia_codigo=a.source_code AND g.articulo_origen_id=a.article_id
), sales_per_article AS MATERIALIZED (
 -- Igual que el Preparador: líneas documentales por artículo ERP y farmacia,
 -- unidas a las cabeceras válidas, con fecha España.
 SELECT a.fid,a.article_id,
  coalesce(sum(CASE WHEN l.devuelta THEN -abs(l.cantidad) ELSE l.cantidad END)
   FILTER(WHERE h.fecha>=(now() AT TIME ZONE 'Europe/Madrid')::date-interval '89 days'),0)::float8 AS units3,
  coalesce(sum(CASE WHEN l.devuelta THEN -abs(l.cantidad) ELSE l.cantidad END),0)::float8 AS units12
 FROM eligible a
 JOIN ${q}.fm_ventas_lineas l ON l.farmacia_codigo=a.source_code
  AND l.articulo_origen_id=a.article_id AND NOT l.eliminada_logicamente
  AND coalesce(l.anulada,false)=false
 JOIN ${q}.fm_ventas_cabeceras h ON h.farmacia_codigo=l.farmacia_codigo
  AND h.sistema_origen=l.sistema_origen AND h.documento_id=l.documento_id
  AND h.lineas_completas AND NOT h.eliminado_logicamente
  AND lower(btrim(h.estado)) NOT IN ('anulado','anulada','cancelado','cancelada','void')
  AND h.fecha>=(now() AT TIME ZONE 'Europe/Madrid')::date-interval '364 days'
  AND h.fecha<(now() AT TIME ZONE 'Europe/Madrid')::date+interval '1 day'
 GROUP BY a.fid,a.article_id
), pending AS MATERIALIZED (
 SELECT p.farmacia_id AS fid,l.line->>'articulo' AS article_id,
  coalesce(sum((assignment.item->>'unidades')::float8),0)::float8 AS ordered
 FROM farmetrica.op_pedidos p
 CROSS JOIN LATERAL jsonb_array_elements(coalesce(p.lineas,'[]'::jsonb)) AS l(line)
 CROSS JOIN LATERAL jsonb_array_elements(coalesce(l.line->'asignaciones','[]'::jsonb)) AS assignment(item)
 WHERE p.cliente_slug=$1 AND p.farmacia_id=ANY($2::int[])
  AND p.estado IN ('borrador','pendiente_aprobacion','aprobado','exportado')
 GROUP BY p.farmacia_id,l.line->>'articulo'
)
SELECT a.fid::text AS "pharmacyId",a.cn,max(a.nombre) AS name,
 max(a.family_id)::text AS "familyId",
 sum(coalesce(a.stock,0))::float8 AS stock,
 min(a.stock_at) AS "stockAt",
 sum(coalesce(s.units3,0))::float8 AS "units3",
 sum(coalesce(s.units12,0))::float8 AS "units12",
 sum(coalesce(p.ordered,0))::float8 AS ordered
FROM eligible a
LEFT JOIN sales_per_article s ON s.fid=a.fid AND s.article_id=a.article_id
LEFT JOIN pending p ON p.fid=a.fid AND p.article_id=a.article_id
GROUP BY a.fid,a.cn`;
}
// Compartir un único cálculo global para filtros y paginación.
const PLAN_CACHE_MS=180000;
const globalRowsCache=new Map();
async function loadTransferRows(pool,schema,slug,ids){
 const request={text:inventorySql(schema),values:[slug,ids],query_timeout:115000};
 // El servidor usa una transacción de solo lectura para ampliar únicamente el
 // timeout de este informe. Los demás módulos conservan sus límites habituales.
 // Un cliente ya adquirido (pruebas de integración) usa su transacción existente.
 if(typeof pool.connect!=="function")
  return (await pool.query(request)).rows;
 const db=await pool.connect();
 const started=Date.now();
 try{
  await db.query("BEGIN READ ONLY");
  await db.query("SET LOCAL statement_timeout='110s'");
  const {rows}=await db.query(request);
  await db.query("COMMIT");
  console.info("TRANSFERIDOR_INVENTARIO",JSON.stringify({
   status:"ok",elapsedMs:Date.now()-started,rows:rows.length,pharmacies:ids.length
  }));
  return rows;
 }catch(e){
  await db.query("ROLLBACK").catch(()=>{});
  console.warn("TRANSFERIDOR_INVENTARIO",JSON.stringify({
   status:"error",elapsedMs:Date.now()-started,code:e.code||e.name||"QUERY_ERROR",
   pharmacies:ids.length
  }));
  throw e;
 }finally{db.release()}
}
function getTransferRows(pool,schema,slug,ids,forceToken=""){
 const key=[slug,schema,...ids].join("|");
 const current=globalRowsCache.get(key);
 const now=Date.now();
 if(current&&(current.expires>now||current.expires===0)&&
  (!forceToken||current.forceToken===forceToken))return current.promise;
 const entry={expires:0,forceToken,promise:null};
 entry.promise=loadTransferRows(pool,schema,slug,ids).then(rows=>{
  entry.expires=Date.now()+PLAN_CACHE_MS;
  return rows;
 }).catch(error=>{
  if(globalRowsCache.get(key)===entry)globalRowsCache.delete(key);
  throw error;
 });
 globalRowsCache.set(key,entry);
 if(globalRowsCache.size>16)globalRowsCache.delete(globalRowsCache.keys().next().value);
 return entry.promise;
}
export function setupTransferidor(app,pool,{requireTenant}){
 app.get("/api/analytics/stock/transferidor",...requireTenant(),async(req,res,next)=>{
  const ctx=req.context,pharmacies=(ctx.pharmacies||[]).filter(p=>p.active!==false);
  if(ctx.role!=="superadministrador"&&ctx.modules?.stock!==true)
   return res.status(403).json({error:"Stock no habilitado"});
  let opts;
  try{opts=parseTransferFilters(req.query,pharmacies);}catch(e){return res.status(400).json({error:e.message});}
  const schema=ctx.client?.schema;
  if(!SCHEMA.test(schema||""))return res.status(400).json({error:"Cliente no válido"});
  const ids=pharmacies.map(p=>Number(p.id));
  if(ids.length<2)return res.json({available:true,rows:[],total:0,
   summary:{movements:0,units:0,products:0},page:opts.page,pageSize:opts.size,
   warning:"Se necesitan dos farmacias autorizadas para proponer movimientos."});
  try{
   const {rows:ready}=await pool.query({
    text:`SELECT f.id::text AS id,EXISTS(
     SELECT 1 FROM "${schema}".articulos a
     WHERE upper(btrim(a.farmacia_codigo))=${pharmacyDataCodeSQL("f")}
    ) AS ready FROM farmetrica.farmacias f
    WHERE f.cliente_slug=$1 AND f.id=ANY($2::int[])`,
    values:[ctx.client.slug,ids],query_timeout:10000});
   const missing=pharmacies.filter(p=>!ready.find(r=>r.id===String(p.id)&&r.ready));
   const available=pharmacies.filter(p=>!missing.includes(p));
   if(available.length<2)return res.json({available:false,rows:[],total:0,page:opts.page,pageSize:opts.size,
    summary:{movements:0,units:0,products:0},
    warning:"No hay dos farmacias con inventario importado para comparar."});
   // Siempre se construye un único plan con todas las farmacias. Las vistas
   // y filtros reutilizan los mismos datos, sin recalcular cada movimiento.
   const rows=await getTransferRows(pool,schema,ctx.client.slug,
    available.map(p=>Number(p.id)),String(req.query.recalcular||""));
   const policy=await readTransferidorPolicy(pool,ctx.client.slug,available.map(p=>Number(p.id)));
   const plan=buildGlobalTransfers(rows,available,policy);
   const filtered=filterTransferPlan(plan.transfers,opts);
   const uniqueProducts=new Set(plan.transfers.map(r=>r.cn)).size;
   const emptyReason=!plan.products?"No hay artículos de parafarmacia con stock para redistribuir.":
    !plan.withSurplus?"No hay existencias sobrantes para redistribuir.":
    !plan.withNeed?"No hay necesidades de reposición que cubrir con transferencias.":
    !plan.transfers.length?"No coinciden los excedentes con las necesidades del mismo producto.":null;
   res.json({available:true,rows:filtered.rows,total:filtered.total,page:opts.page,pageSize:opts.size,
    emptyReason,
    summary:{movements:plan.transfers.length,units:plan.transfers.reduce((sum,r)=>sum+r.units,0),
     products:uniqueProducts,filteredUnits:filtered.units,coverageDays:policy.targetDays,
     minimumDays:policy.minDays,targetDays:policy.targetDays,skipped:plan.skipped,
     analyzed:plan.products,withNeed:plan.withNeed,withSurplus:plan.withSurplus},
    calculatedAt:new Date().toISOString(),
    warning:missing.length?"Stock pendiente en "+missing.map(p=>p.name).join(", ")+
     ". Se han calculado las otras farmacias.":plan.skipped?
     plan.skipped+" referencias sin stock fiable omitidas.":null});
  }catch(e){
   if(["57014","53300"].includes(e.code)||e.message==="Query read timeout")return res.status(504).json({error:"El cálculo de transferencias ha superado el tiempo disponible. Inténtalo más tarde."});
   next(e);
  }
 });
}
