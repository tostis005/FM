// Detalle paginado del período solicitado: ABCD de ese rango, márgenes de la página.
// No se recalculan aquí gráficos, totales históricos ni indicadores de recuento.
import {validSalesDateRange} from "./salesAnalysisPeriod.js";
const VALID=/^[a-z][a-z0-9_]{1,62}$/;
const ISO=/^20\d{2}-\d{2}-\d{2}$/;
// Columnas permitidas para ordenar todo el universo SQL, antes del LIMIT/OFFSET.
export const SALES_DETAIL_SORT_KEYS=["name","cn","family","pharmacy","abcdClass",
 "pvp","purchaseCost","costSource","saleUnitPrice","unitMargin","units",
 "value","margin","marginPct"];
export function buildSalesDetailSQL(schema,sortKey="value",sortDir="desc",
 {articles="normalized",purchases="normalized"}={}){
 if(!VALID.test(schema))throw Error("Esquema no permitido");
 if(!SALES_DETAIL_SORT_KEYS.includes(sortKey)||!["asc","desc"].includes(sortDir)||
   !["normalized","legacy","none"].includes(articles)||
   !["normalized","legacy","none"].includes(purchases))
  throw Error("Ordenación o formato de detalle de ventas inválido");
 const t='"'+schema+'"';
 const purchasePrice=purchases==="legacy"?"b.puc":"b.coste_unitario";
 const purchaseJoin=purchases==="legacy"?`JOIN ${t}.compras b
     ON b.farmacia_id::text=c."pharmacyId" AND b.producto_id=c.articulo_id
       AND b.fecha >= $1::date AND b.fecha < ($2::date+interval '1 day')`:
   `JOIN ${t}.compras b ON upper(btrim(b.farmacia_codigo))=c.code
     AND b.articulo_id=c.articulo_id
     AND b.fecha >= $1::date AND b.fecha < ($2::date+interval '1 day')`;
 const purchaseCosts=source=>purchases==="none"?
  `SELECT c."pharmacyId",c.cn,NULL::float8 AS cost,
    NULL::float8 AS priced_units FROM catalog c WHERE false`:
  `SELECT c."pharmacyId",c.cn,
    sum(b.unidades*${purchasePrice}) FILTER(
      WHERE b.unidades>0 AND ${purchasePrice}>0)::float8 AS cost,
    sum(b.unidades) FILTER(
      WHERE b.unidades>0 AND ${purchasePrice}>0)::float8 AS priced_units
   FROM ${source} JOIN catalog c ON c."pharmacyId"=${source}."pharmacyId" AND c.cn=${source}.cn
   ${purchaseJoin}
   GROUP BY c."pharmacyId",c.cn`;
 const articleJoin=articles==="normalized"?
   `LEFT JOIN LATERAL (
    SELECT a.codigo_nacional,a.nombre,a.familia,a.pmc,a.pvp FROM ${t}.articulos a
    WHERE upper(btrim(a.farmacia_codigo))=r.code
      AND a.origen_id=r.articulo_id
    ORDER BY a.sincronizado_en DESC NULLS LAST LIMIT 1
   ) a ON true`:
  articles==="legacy"?`LEFT JOIN LATERAL (
    SELECT p.cn AS codigo_nacional,p.descripcion AS nombre,
      p.familia,NULL::numeric AS pmc,NULL::numeric AS pvp
    FROM ${t}.productos p WHERE p.id=r.articulo_id LIMIT 1
   ) a ON true`:
  `LEFT JOIN LATERAL (
     SELECT NULL::text AS codigo_nacional,NULL::text AS nombre,
       NULL::text AS familia,NULL::numeric AS pmc,NULL::numeric AS pvp
     WHERE false
   ) a ON true`;
 const catalogCost=v=>`CASE WHEN ${v}.pmc>0 THEN ${v}.pmc ELSE NULL END`;
 const needsGlobalCosts=["purchaseCost","costSource","unitMargin","margin","marginPct"].includes(sortKey);
 const directions=sortDir.toUpperCase();
 const sortExpressions={
  name:"name",cn:"cn",family:"family",
  pharmacy:'(SELECT fp.nombre FROM farmetrica.farmacias fp WHERE fp.id::text="pharmacyId")',
  abcdClass:'"abcdClass"',pvp:"pvp",units:"units",value:"value",
  saleUnitPrice:"CASE WHEN units>0 THEN value/units ELSE NULL END",
  purchaseCost:'"globalPurchaseCost"',costSource:'"globalCostSource"',
  unitMargin:'"globalUnitMargin"',margin:'"globalMargin"',marginPct:'"globalMarginPct"'
 };
 const globalCosts=needsGlobalCosts?`
 global_costs AS (
   ${purchaseCosts("visible")}
 ),
 with_cost_sort AS (
   SELECT v.*,
    CASE WHEN gc.priced_units>0 THEN gc.cost/gc.priced_units ELSE ${catalogCost("v")} END AS "globalPurchaseCost",
    CASE WHEN gc.priced_units>0 THEN 'Compras ponderadas'
      WHEN v.pmc>0 THEN 'PMC catálogo' ELSE NULL END AS "globalCostSource",
    CASE WHEN v.units>0 THEN v.value/v.units-
      (CASE WHEN gc.priced_units>0 THEN gc.cost/gc.priced_units ELSE ${catalogCost("v")} END)
      ELSE NULL END AS "globalUnitMargin",
    v.value-v.units*(CASE WHEN gc.priced_units>0 THEN gc.cost/gc.priced_units ELSE ${catalogCost("v")} END) AS "globalMargin",
    100*(v.value-v.units*(CASE WHEN gc.priced_units>0 THEN gc.cost/gc.priced_units ELSE ${catalogCost("v")} END))
      /NULLIF(v.value,0) AS "globalMarginPct"
   FROM visible v LEFT JOIN global_costs gc
     ON gc."pharmacyId"=v."pharmacyId" AND gc.cn=v.cn
 ),
 `:"";
 const unitCost=`(CASE WHEN co.priced_units>0 THEN co.cost/co.priced_units ELSE ${catalogCost("p")} END)`;
 const soldPrice=`(CASE WHEN p.units>0 THEN p.value/p.units ELSE NULL END)`;
 return `
 WITH pharmacy_map AS (
  SELECT * FROM unnest($3::text[],$4::text[]) AS p(code,pharmacy_id)
 ),
 raw AS MATERIALIZED (
  SELECT upper(btrim(v.farmacia_codigo)) AS code,v.articulo_id,
    sum(v.unidades)::float8 AS units,sum(v.importe)::float8 AS value
  FROM ${t}.ventas v
  WHERE upper(btrim(v.farmacia_codigo))=ANY($3::text[])
    AND v.fecha >= $1::date AND v.fecha < ($2::date+interval '1 day')
    AND nullif(btrim(v.articulo_id),'') IS NOT NULL
  GROUP BY 1,2
 ),
 catalog AS MATERIALIZED (
  SELECT pm.pharmacy_id AS "pharmacyId",r.code,r.articulo_id,r.units,r.value,
    coalesce(nullif(btrim(a.codigo_nacional),''),btrim(r.articulo_id)) AS cn,
    coalesce(nullif(a.nombre,''),r.articulo_id) AS name,
    coalesce(a.familia,'') AS family,a.pmc::float8 AS pmc,a.pvp::float8 AS pvp
  FROM raw r JOIN pharmacy_map pm ON pm.code=r.code
  ${articleJoin}
 ),
 grouped AS MATERIALIZED (
  SELECT "pharmacyId",cn,max(name) AS name,max(family) AS family,
    max(pmc) AS pmc,max(pvp) AS pvp,sum(units)::float8 AS units,sum(value)::float8 AS value
  FROM catalog GROUP BY "pharmacyId",cn
 ),
 ranked AS (
  SELECT g.*,sum(greatest(g.value,0)) OVER(PARTITION BY "pharmacyId") AS total_positive,
   coalesce(sum(greatest(g.value,0)) OVER(
    PARTITION BY "pharmacyId" ORDER BY greatest(g.value,0) DESC,g.units DESC,g.cn
    ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) AS previous_positive
  FROM grouped g
 ),
 visible AS (
  SELECT r.*,
   CASE WHEN r.value<=0 AND r.units<=0 THEN 'D'
     WHEN r.total_positive<=0 THEN 'C'
     WHEN r.previous_positive<r.total_positive*.80 THEN 'A'
     WHEN r.previous_positive<r.total_positive*.95 THEN 'B' ELSE 'C' END AS "abcdClass"
  FROM ranked r
  WHERE ($5::text='' OR r.cn ILIKE '%'||$5||'%' OR r.name ILIKE '%'||$5||'%')
    AND (cardinality($6::text[])=0 OR r.family=ANY($6::text[]))
 ),
 ${globalCosts}
 page AS MATERIALIZED (
  SELECT "pharmacyId",cn,name,family,units,value,pmc,pvp,"abcdClass",
    ${sortExpressions[sortKey]} AS "__order"
  FROM ${needsGlobalCosts?"with_cost_sort":"visible"}
  ORDER BY "__order" ${directions} NULLS LAST,"pharmacyId",cn
  LIMIT $7::int OFFSET $8::int
 ),
 costs AS (
   ${purchaseCosts("page")}
 )

 SELECT p."pharmacyId",p.cn,p.name,p.family,p.units,p.value,p.pvp,p."abcdClass",
  CASE WHEN co.priced_units>0 THEN 'Compras ponderadas'
    WHEN p.pmc>0 THEN 'PMC catálogo' ELSE NULL END AS "costSource",
  CASE WHEN ${unitCost} IS NOT NULL THEN round(${unitCost}::numeric,4)::float8 ELSE NULL END AS "purchaseCost",
  CASE WHEN ${soldPrice} IS NOT NULL THEN round(${soldPrice}::numeric,4)::float8 ELSE NULL END AS "saleUnitPrice",
  CASE WHEN ${soldPrice} IS NOT NULL AND ${unitCost} IS NOT NULL THEN
    round((${soldPrice}-${unitCost})::numeric,4)::float8 ELSE NULL END AS "unitMargin",
  CASE WHEN ${unitCost} IS NOT NULL THEN
    round((p.value-p.units*${unitCost})::numeric,2)::float8 ELSE NULL END AS margin,
  CASE WHEN p.value<>0 AND ${unitCost} IS NOT NULL THEN
    round((100*(p.value-p.units*${unitCost})/p.value)::numeric,2)::float8 ELSE NULL END AS "marginPct"
 FROM page p LEFT JOIN costs co
   ON co."pharmacyId"=p."pharmacyId" AND co.cn=p.cn
 ORDER BY p."__order" ${directions} NULLS LAST,p."pharmacyId",p.cn`;
}
export function setupSalesDetail(app,pool,{requireTenant,cache=null}){
 app.get("/api/analytics/ventas/detalle",...requireTenant(),async(req,res,next)=>{
  try{
   if(req.context.role!=="superadministrador"&&
     !req.context.modules?.ventas&&!req.context.modules?.dashboard)
    return res.status(403).json({error:"Módulo de ventas no habilitado"});
   const from=String(req.query.desde||""),to=String(req.query.hasta||"");
   const raw=String(req.query.farmacias||""),search=String(req.query.buscar||"").trim();
   const families=String(req.query.familias||"").split(",").filter(Boolean);
   const page=Number(req.query.pagina||1);
   const order=String(req.query.orden||"value");
   const direction=String(req.query.direccion||"desc").toLowerCase();
   if(!validSalesDateRange(from,to)||
     !Number.isSafeInteger(page)||page<1||page>1000||
     !SALES_DETAIL_SORT_KEYS.includes(order)||!["asc","desc"].includes(direction)||
     raw.length>2000||search.length>100||families.length>30||
     families.some(x=>x.length>80)||(raw&&raw.split(",").some(s=>!/^[1-9]\d{0,8}$/.test(s))))
    return res.status(400).json({error:"Filtros de detalle no válidos"});
   const allowed=req.context.allowedPharmacyIds.map(Number);
   const ids=[...new Set(raw?raw.split(",").map(Number):allowed)];
   if(ids.some(id=>!allowed.includes(id)))
    return res.status(403).json({error:"Farmacia no autorizada"});
   if(families.length&&ids.length!==1)
    return res.status(400).json({error:"La familia solo puede filtrarse dentro de una farmacia"});
   const byId=new Map((req.context.pharmacies||[]).map(p=>[
    Number(p.id),String(p.databaseCode||p.sourceCode||"").trim().toUpperCase()]));
   if(ids.some(id=>!byId.get(id)))return res.status(503).json({error:"Farmacia sin código ERP"});
   const schema=req.context.client.schema;
   if(!VALID.test(schema))throw Error("Esquema no permitido");
   if(!ids.length)return res.json({products:[],hasMore:false,page});
   let source={articles:"normalized",purchases:"normalized"};
   if(req.context.client.slug!=="ampedia"){
    const {rows:fields}=await pool.query(
      "SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=ANY($2::text[])",
      [schema,["ventas","articulos","productos","compras"]]);
    const byTable=new Map();
    for(const field of fields){
     if(!byTable.has(field.table_name))byTable.set(field.table_name,new Set());
     byTable.get(field.table_name).add(field.column_name);
    }
    const has=(table,...cols)=>cols.every(c=>byTable.get(table)?.has(c));
    if(!has("ventas","farmacia_codigo","articulo_id","fecha","unidades","importe"))
     return res.status(422).json({error:"No hay ventas normalizadas sincronizadas para este cliente"});
    source={
     articles:has("articulos","farmacia_codigo","origen_id","codigo_nacional",
       "nombre","familia","pmc","pvp","sincronizado_en")?"normalized":
       has("productos","id","descripcion","cn","familia")?"legacy":"none",
     purchases:has("compras","farmacia_codigo","articulo_id","fecha","unidades","coste_unitario")?
       "normalized":
       has("compras","farmacia_id","producto_id","fecha","unidades","puc")?"legacy":"none"
    };
   }
   const pageSize=400;
   if(cache){
    const args={slug:req.context.client.slug,ids,months:Number(req.context.client.analysisMonths||12),
     from,to,search,families,sortKey:order,sortDir:direction,page,pageSize};
    const cached=await cache.read(args);
    const refresh=()=>{
     for(const id of ids)cache.schedule({
      slug:req.context.client.slug,schema,pharmacyId:id,months:args.months,code:byId.get(id)});
    };
    if(cached){
     if(cached.stale)refresh();
     return res.json({...cached,from,to});
    }
    // Solo reconstruir el precálculo si la pantalla consulta la ventana
    // preconfigurada. Un rango personalizado nunca debe disparar un
    // escaneo nocturno innecesario por abrir el detalle.
    if(cache.isCacheRange?.(args)&&typeof res.once==="function")
     res.once("finish",refresh);
   }
   const {rows}=await pool.query(buildSalesDetailSQL(schema,order,direction,source),
    [from,to,ids.map(id=>byId.get(id)),ids.map(String),search,families,
     pageSize+1,(page-1)*pageSize]);
   res.json({products:rows.slice(0,pageSize).map(x=>({
    ...x,id:x.pharmacyId+"|"+x.cn,pharmacyId:String(x.pharmacyId)
   })),hasMore:rows.length>pageSize,page,from,to});
  }catch(e){next(e)}
 });
}
