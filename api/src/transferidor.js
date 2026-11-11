// Transferidor (solo lectura). Ninguna propuesta modifica el stock ni ejecuta movimientos.
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
const SCHEMA=/^[a-z][a-z0-9_]{1,62}$/;
const SORT=new Set(["cn","name","originName","destinationName","units","stockOrigin","stockDestination","targetOrigin","targetDestination"]);
const FILTERS=new Set(["cn","name","originName","destinationName","units","stockOrigin","stockDestination"]);
const CAP=999999;
const asNumber=value=>Number.isFinite(Number(value))?Number(value):0;
const whole=value=>Math.max(0,Math.min(CAP,Math.ceil(asNumber(value)-1e-9)));
const identity=cn=>/^\d{8,14}$/.test(String(cn||""))||(/^\d{6,7}$/.test(String(cn||""))&&Number(String(cn).slice(0,6))<400000);
const stable=(a,b)=>String(a).localeCompare(String(b),"es",{numeric:true});

// El plan se calcula de una vez, antes de filtrar o paginar. Cada donante
// dispone de un saldo restante que se reduce tras CADA propuesta: no hay doble asignación.
export function buildGlobalTransfers(rows,pharmacies,coverageDays=20){
 const validSites=new Map(pharmacies.map(p=>[String(p.id),p]));
 const products=new Map();
 for(const r of rows||[]){
  const id=String(r.pharmacyId||""),cn=String(r.cn||"").trim();
  if(!validSites.has(id)||!identity(cn))continue;
  if(!products.has(cn))products.set(cn,{cn,name:String(r.name||cn),sites:new Map()});
  const group=products.get(cn);
  if(!group.sites.has(id))group.sites.set(id,r);
 }
 const transfers=[];let skipped=0,withNeed=0,withSurplus=0;
 for(const product of products.values()){
  const sites=[...validSites.values()].map(p=>{
   const src=product.sites.get(String(p.id));
   const rawStock=src?src.stock:0;
   if(rawStock===null||rawStock===undefined||!Number.isFinite(Number(rawStock))||Number(rawStock)<0)
    return {invalid:true};
   const stock=Math.max(0,asNumber(rawStock));
   const sold3=Math.max(0,asNumber(src?.units3));
   const sold12=Math.max(0,asNumber(src?.units12));
   const target=whole(Math.max(sold3/90,sold12/365)*coverageDays);
   const ordered=Math.max(0,asNumber(src?.ordered));
   return {id:String(p.id),name:p.name||String(p.id),stock,target,ordered,
    need:whole(Math.max(0,target-stock-ordered)),
    surplus:Math.max(0,Math.floor(stock-target+1e-9)),
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
function inventorySql(schema){
 const q='"'+schema+'"',source=pharmacyDataCodeSQL("f");
 return `WITH chosen AS MATERIALIZED (
 SELECT f.id,${source} AS source_code
 FROM farmetrica.farmacias f
 WHERE f.cliente_slug=$1 AND f.id=ANY($2::int[]) AND f.activo=true
  AND coalesce(to_jsonb(f)->>'tipo_establecimiento','farmacia')='farmacia'
), aliases AS MATERIALIZED (
 -- Los CN de articulos están vacíos en la fuente actual: usar los sinónimos
 -- vinculados por farmacia + artículo ERP, NUNCA un ID ERP de otra farmacia.
 SELECT f.id AS fid,f.source_code,s.articulo_id::text AS article_id,
  btrim(s.codigo) AS ean
 FROM chosen f
 JOIN ${q}.sinonimos s ON upper(btrim(s.farmacia_codigo))=f.source_code
 JOIN ${q}.articulos a ON upper(btrim(a.farmacia_codigo))=f.source_code
  AND a.origen_id::text=s.articulo_id::text
 WHERE btrim(s.codigo)~'^[0-9]{8,14}$'
  -- Misma separación provisional de parafarmacia que el Preparador.
  AND a.origen_id::text~'^[0-9]{6,7}$'
  AND left(a.origen_id::text,6)::int<400000
), safe_eans AS MATERIALIZED (
 -- Un EAN que identifica dos artículos distintos en la MISMA farmacia es ambiguo.
 SELECT fid,source_code,ean,max(article_id) AS article_id
 FROM aliases GROUP BY fid,source_code,ean
 HAVING count(DISTINCT article_id)=1
), shared AS MATERIALIZED (
 SELECT ean,count(DISTINCT fid)::int AS site_count
 FROM safe_eans GROUP BY ean HAVING count(DISTINCT fid)>1
), canonical AS MATERIALIZED (
 -- Elegir un EAN común por ficha, con preferencia por el que comparten
 -- más farmacias. Previene duplicar stock de artículos con varios sinónimos.
 SELECT DISTINCT ON (s.fid,s.article_id)
  s.fid,s.source_code,s.article_id,s.ean
 FROM safe_eans s JOIN shared sh ON sh.ean=s.ean
 ORDER BY s.fid,s.article_id,sh.site_count DESC,s.ean
), selected AS MATERIALIZED (
 SELECT c.fid,c.source_code,c.article_id,c.ean,a.nombre,
  a.stock_actual::float8 AS stock,a.sincronizado_en AS stock_at
 FROM canonical c JOIN ${q}.articulos a
 ON upper(btrim(a.farmacia_codigo))=c.source_code
  AND a.origen_id::text=c.article_id
), donors AS MATERIALIZED (
 SELECT DISTINCT ean FROM selected WHERE stock>0
), eligible AS MATERIALIZED (
 SELECT a.* FROM selected a JOIN donors d ON d.ean=a.ean
), sales AS MATERIALIZED (
 SELECT a.fid,a.article_id,
  coalesce(sum(CASE WHEN l.devuelta THEN -abs(l.cantidad) ELSE l.cantidad END)
   FILTER(WHERE h.fecha >= (now() AT TIME ZONE 'Europe/Madrid')::date-interval '89 days'),0)::float8 AS units3,
  coalesce(sum(CASE WHEN l.devuelta THEN -abs(l.cantidad) ELSE l.cantidad END),0)::float8 AS units12
 FROM eligible a
 JOIN ${q}.fm_ventas_lineas l ON l.farmacia_codigo=a.source_code
  AND l.articulo_origen_id=a.article_id
  AND NOT l.eliminada_logicamente AND coalesce(l.anulada,false)=false
 JOIN ${q}.fm_ventas_cabeceras h ON h.farmacia_codigo=l.farmacia_codigo
  AND h.sistema_origen=l.sistema_origen AND h.documento_id=l.documento_id
  AND h.lineas_completas AND NOT h.eliminado_logicamente
  AND lower(btrim(h.estado)) NOT IN ('anulado','anulada','cancelado','cancelada','void')
 WHERE h.fecha >= (now() AT TIME ZONE 'Europe/Madrid')::date-interval '364 days'
  AND h.fecha < (now() AT TIME ZONE 'Europe/Madrid')::date+interval '1 day'
 GROUP BY a.fid,a.article_id
), pending AS MATERIALIZED (
 SELECT p.farmacia_id AS fid,l.line->>'articulo' AS article_id,
  coalesce(sum((assign.item->>'unidades')::float8),0)::float8 AS ordered
 FROM farmetrica.op_pedidos p
 CROSS JOIN LATERAL jsonb_array_elements(coalesce(p.lineas,'[]'::jsonb)) AS l(line)
 CROSS JOIN LATERAL jsonb_array_elements(coalesce(l.line->'asignaciones','[]'::jsonb)) AS assign(item)
 WHERE p.cliente_slug=$1 AND p.farmacia_id=ANY($2::int[])
 AND p.estado IN ('borrador','pendiente_aprobacion','aprobado','exportado')
 GROUP BY p.farmacia_id,l.line->>'articulo'
)
SELECT a.fid::text AS "pharmacyId",a.ean AS cn,max(a.nombre) AS name,
 CASE WHEN count(a.stock)=count(*) THEN sum(a.stock)::float8 ELSE NULL END AS stock,
 min(a.stock_at) AS "stockAt",
 sum(coalesce(s.units3,0))::float8 AS "units3",
 sum(coalesce(s.units12,0))::float8 AS "units12",
 sum(coalesce(p.ordered,0))::float8 AS ordered
FROM eligible a
LEFT JOIN sales s ON s.fid=a.fid AND s.article_id=a.article_id
LEFT JOIN pending p ON p.fid=a.fid AND p.article_id=a.article_id
GROUP BY a.fid,a.ean
ORDER BY a.ean,a.fid`;
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
   const {rows}=await pool.query({text:inventorySql(schema),
    values:[ctx.client.slug,available.map(p=>Number(p.id))],query_timeout:30000});
   const {rows:settings}=await pool.query("SELECT cobertura_dias AS days FROM farmetrica.preparador_configuracion_cliente WHERE cliente_slug=$1",[ctx.client.slug]);
   const coverageDays=Math.max(1,Math.min(365,Number(settings[0]?.days)||20));
   const plan=buildGlobalTransfers(rows,available,coverageDays);
   const filtered=filterTransferPlan(plan.transfers,opts);
   const uniqueProducts=new Set(plan.transfers.map(r=>r.cn)).size;
   const emptyReason=!plan.products?"No hay artículos de parafarmacia con EAN común y stock.":
    !plan.withSurplus?"No hay existencias sobrantes para redistribuir.":
    !plan.withNeed?"No hay necesidades de reposición que cubrir con transferencias.":
    !plan.transfers.length?"No coinciden los excedentes con las necesidades del mismo producto.":null;
   res.json({available:true,rows:filtered.rows,total:filtered.total,page:opts.page,pageSize:opts.size,
    emptyReason,
    summary:{movements:plan.transfers.length,units:plan.transfers.reduce((sum,r)=>sum+r.units,0),
     products:uniqueProducts,filteredUnits:filtered.units,coverageDays,skipped:plan.skipped,
     analyzed:plan.products,withNeed:plan.withNeed,withSurplus:plan.withSurplus},
    calculatedAt:new Date().toISOString(),
    warning:missing.length?"Stock pendiente en "+missing.map(p=>p.name).join(", ")+
     ". Se han calculado las otras farmacias.":plan.skipped?
     plan.skipped+" referencias sin stock fiable omitidas.":null});
  }catch(e){
   if(["57014","53300"].includes(e.code))return res.status(504).json({error:"El cálculo de transferencias ha superado el tiempo disponible. Inténtalo más tarde."});
   next(e);
  }
 });
}
