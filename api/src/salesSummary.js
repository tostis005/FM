// Un solo viaje a PostgreSQL para la pantalla de Ventas.
// Ningún movimiento/ticket bruto sale del servidor.
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
import {includedPurchaseSupplier} from "./supplierReporting.js";

const ISO=/^20\d{2}-\d{2}-\d{2}$/;
function validDate(s){if(!ISO.test(s))return false;const d=new Date(s+"T00:00:00Z");return !isNaN(d.getTime())&&d.toISOString().slice(0,10)===s}
function filters(req,res){
 const from=String(req.query.desde||""),to=String(req.query.hasta||""),
 raw=String(req.query.farmacias||""),search=String(req.query.buscar||"").trim(),
 families=String(req.query.familias||"").split(",").filter(Boolean),
 granularity=String(req.query.granularidad||"month");
 if(!validDate(from)||!validDate(to)||from>to||Date.parse(to)-Date.parse(from)>366*86400000||
   raw.length>2000||search.length>100||families.length>30||families.some(f=>f.length>80)||
   !["hour","day","month"].includes(granularity)||
   (raw&&raw.split(",").some(s=>!/^[1-9]\d{0,8}$/.test(s)))){
  res.status(400).json({error:"Filtros de ventas inválidos"});return null;
 }
 const allowed=req.context.allowedPharmacyIds.map(Number);
 const ids=raw?raw.split(",").map(Number):allowed;
 if(ids.some(id=>!allowed.includes(id))){res.status(403).json({error:"Farmacia no autorizada"});return null}
 const schema=req.context.client.schema;
 if(!/^[a-z][a-z0-9_]{1,62}$/.test(schema))throw Error("Esquema de cliente inválido");
 return {from,to,ids:[...new Set(ids)],search,families,granularity,schema,tenant:req.context.client.slug};
}

export function buildSalesSummarySql(schema,granularity,hasProductFilters=false){
 if(!/^[a-z][a-z0-9_]{1,62}$/.test(schema)||!["hour","day","month"].includes(granularity))
  throw Error("Identificador SQL inválido");
 const tbl='"'+schema+'"';
 const bucket=granularity==="hour"?'YYYY-MM-DD"T"HH24:MI':granularity==="day"?"YYYY-MM-DD":"YYYY-MM";
 const monthSeries=granularity==="month";
 const seriesSql=monthSeries?"SELECT month AS bucket,unidades,ventas FROM monthly":
   "SELECT to_char(date_trunc('"+granularity+"',fecha),'"+bucket+"') AS bucket, "+
   "sum(unidades)::float8 AS unidades,sum(importe)::float8 AS ventas FROM filtered GROUP BY 1";
 return `
 WITH sales_scope AS MATERIALIZED (
  SELECT f.id::text AS pharmacy_id,upper(btrim(v.farmacia_codigo)) AS source_code,
    v.articulo_id,v.fecha,v.unidades,v.importe
  FROM ${tbl}.ventas v JOIN farmetrica.farmacias f
    ON f.cliente_slug=$4 AND upper(btrim(v.farmacia_codigo))=${pharmacyDataCodeSQL("f")}
  WHERE f.id=ANY($3::int[]) AND v.fecha >= $1::date AND v.fecha < $2::date+interval '1 day'
    AND nullif(btrim(v.articulo_id),'') IS NOT NULL
 ),
 raw_products AS MATERIALIZED (
  SELECT pharmacy_id,source_code,articulo_id,
   sum(unidades)::float8 AS units,sum(importe)::float8 AS value
  FROM sales_scope GROUP BY pharmacy_id,source_code,articulo_id
 ),
 catalog AS MATERIALIZED (
  SELECT k.pharmacy_id,k.source_code,k.articulo_id,k.units,k.value,
    coalesce(nullif(btrim(a.codigo_nacional),''),btrim(k.articulo_id)) AS cn,
    coalesce(nullif(a.nombre,''),k.articulo_id) AS name,
    coalesce(a.familia,'') AS family,a.pmc::float8 AS pmc
  FROM raw_products k LEFT JOIN LATERAL (
    SELECT a.codigo_nacional,a.nombre,a.familia,a.pmc FROM ${tbl}.articulos a
    WHERE upper(btrim(a.farmacia_codigo))=k.source_code AND a.origen_id=k.articulo_id
    ORDER BY a.sincronizado_en DESC NULLS LAST LIMIT 1
  ) a ON true
 ),
 active_products AS MATERIALIZED (
  SELECT * FROM catalog c WHERE
    ($5::text='' OR c.cn ILIKE '%'||$5||'%' OR c.name ILIKE '%'||$5||'%'
     OR c.articulo_id ILIKE '%'||$5||'%')
    AND (cardinality($6::text[])=0 OR c.family=ANY($6::text[]))
 ),
 filtered AS MATERIALIZED (
  SELECT s.fecha,s.unidades,s.importe FROM sales_scope s
  ${hasProductFilters?`JOIN active_products c ON c.pharmacy_id=s.pharmacy_id
     AND c.source_code=s.source_code AND c.articulo_id=s.articulo_id`:""}
 ),
 monthly AS MATERIALIZED (
  SELECT to_char(date_trunc('month',fecha),'YYYY-MM') AS month,
    sum(unidades)::float8 AS unidades,sum(importe)::float8 AS ventas
  FROM filtered GROUP BY 1
 ),
 series AS (${seriesSql}),
 product_groups AS MATERIALIZED (
  SELECT pharmacy_id AS "pharmacyId",cn,max(name) AS name,max(family) AS family,max(pmc) AS pmc,
    sum(units)::float8 AS units,sum(value)::float8 AS value
  FROM catalog GROUP BY pharmacy_id,cn
 ),
 visible_groups AS MATERIALIZED (
  SELECT pharmacy_id AS "pharmacyId",cn,max(name) AS name,max(family) AS family,max(pmc) AS pmc,
    sum(units)::float8 AS units,sum(value)::float8 AS value
  FROM active_products GROUP BY pharmacy_id,cn
 ),
 ranking AS (
  SELECT p.*,sum(greatest(p.value,0)) OVER(PARTITION BY p."pharmacyId") AS total_positive,
    coalesce(sum(greatest(p.value,0)) OVER (
     PARTITION BY p."pharmacyId" ORDER BY greatest(p.value,0) DESC,p.units DESC,p.cn
     ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) AS previous_positive
  FROM product_groups p
 ),
 classified AS MATERIALIZED (
  SELECT r.*,CASE WHEN r.value<=0 AND r.units<=0 THEN 'D'
     WHEN r.total_positive<=0 THEN 'C'
     WHEN r.previous_positive<r.total_positive*0.80 THEN 'A'
     WHEN r.previous_positive<r.total_positive*0.95 THEN 'B' ELSE 'C' END AS "abcdClass"
  FROM ranking r
 ),
 top_products AS (
  SELECT v."pharmacyId",v.cn,v.name,v.family,v.units,v.value,
    c."abcdClass",v.pmc
  FROM visible_groups v JOIN classified c
    ON c."pharmacyId"=v."pharmacyId" AND c.cn=v.cn
  ORDER BY v.value DESC NULLS LAST LIMIT 3000
 ),
 counts AS (
  SELECT count(*)::int AS total_products,count(DISTINCT cn)::int AS total_articles FROM visible_groups
 ),
 purchase_costs AS (
  SELECT f.id::text AS pharmacy_id,b.articulo_id,
    sum(b.unidades*b.coste_unitario) FILTER(WHERE b.unidades>0 AND b.coste_unitario>0)::float8 AS cost,
    sum(b.unidades) FILTER(WHERE b.unidades>0 AND b.coste_unitario>0)::float8 AS priced_units
  FROM ${tbl}.compras b JOIN farmetrica.farmacias f
    ON f.cliente_slug=$4 AND upper(btrim(b.farmacia_codigo))=${pharmacyDataCodeSQL("f")}
  WHERE f.id=ANY($3::int[]) AND b.fecha >= $1::date AND b.fecha < $2::date+interval '1 day'
    AND ${includedPurchaseSupplier({tenant:"$4",code:"b.proveedor_id"})}
  GROUP BY f.id,b.articulo_id
 ),
 purchase_cns AS (
  SELECT c.pharmacy_id,c.cn,sum(p.cost) AS cost,sum(p.priced_units) AS priced_units
  FROM purchase_costs p JOIN catalog c ON c.pharmacy_id=p.pharmacy_id AND c.articulo_id=p.articulo_id
  GROUP BY c.pharmacy_id,c.cn
 ),
 products_with_margin AS (
  SELECT t."pharmacyId",t.cn,t.name,t.family,t.units,t.value,t."abcdClass",
    CASE WHEN pc.priced_units>0
      THEN round((t.value-t.units*(pc.cost/pc.priced_units))::numeric,2)::float8
      WHEN t.pmc IS NOT NULL
      THEN round((t.value-t.units*t.pmc)::numeric,2)::float8
      ELSE NULL END AS margin
  FROM top_products t LEFT JOIN purchase_cns pc
   ON pc.pharmacy_id=t."pharmacyId" AND pc.cn=t.cn
 ),
 totals AS (
  SELECT coalesce(sum(ventas),0)::float8 AS ventas,
    coalesce(sum(unidades),0)::float8 AS unidades FROM monthly
 ),
 coverage AS (
  SELECT count(*)::int AS known,count(margin)::int AS priced,
    CASE WHEN count(*)=count(margin) THEN sum(margin)::float8 ELSE NULL END AS margin
  FROM products_with_margin
 )
 SELECT
  (SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.month),'[]'::jsonb) FROM monthly m) AS monthly,
  (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.bucket),'[]'::jsonb) FROM series s) AS series,
  (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.value DESC),'[]'::jsonb) FROM products_with_margin p) AS products,
  (SELECT coalesce(jsonb_agg(x.family ORDER BY x.family),'[]'::jsonb)
   FROM (SELECT DISTINCT family FROM catalog WHERE family<>'' ORDER BY family LIMIT 250) x) AS families,
  (SELECT to_jsonb(counts) FROM counts) AS counts,
  (SELECT to_jsonb(totals) FROM totals) AS totals,
  (SELECT to_jsonb(coverage) FROM coverage) AS coverage
 `;
}
export function setupSalesSummary(app,pool,{requireTenant}){
 app.get("/api/analytics/ventas/resumen",...requireTenant(),async(req,res,next)=>{
  try{
   if(req.context.role!=="superadministrador"&&
      !req.context.modules.ventas&&!req.context.modules.dashboard)
    return res.status(403).json({error:"Módulo de ventas no habilitado"});
   const f=filters(req,res);if(!f)return;
   if(!f.ids.length)return res.json({monthly:[],series:[],products:[],families:[],
    totalProducts:0,totalArticles:0,granularity:f.granularity,
    kpis:{ventas:0,unidades:0,articulosVendidos:0,margen:null},from:f.from,to:f.to});
   const {rows}=await pool.query(buildSalesSummarySql(f.schema,f.granularity,Boolean(f.search||f.families.length)),
    [f.from,f.to,f.ids,f.tenant,f.search,f.families]);
   const data=rows[0]||{};
   const totalProducts=Number(data.counts?.total_products||0);
   const products=(data.products||[]).map(r=>({...r,
    pharmacyId:String(r.pharmacyId),id:String(r.pharmacyId)+"|"+r.cn,
    margin:r.margin==null?null:Number(r.margin)}));
   res.json({monthly:data.monthly||[],series:data.series||[],products,
    families:data.families||[],totalProducts,totalArticles:Number(data.counts?.total_articles||0),
    granularity:f.granularity,from:f.from,to:f.to,
    kpis:{ventas:Number(data.totals?.ventas||0),unidades:Number(data.totals?.unidades||0),
      articulosVendidos:Number(data.counts?.total_articles||0),
      margen:totalProducts<=3000?data.coverage?.margin??null:null},
    truncated:totalProducts>3000
   });
  }catch(e){next(e)}
 });
}
