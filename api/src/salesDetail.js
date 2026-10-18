// Detalle de ventas paginado: ABCD de últimos 12 meses, márgenes SOLO de la página.
// No se recalculan aquí gráficos, totales históricos ni indicadores de recuento.
import {approvedAnalysisRange} from "./salesAnalysisPeriod.js";
const VALID=/^[a-z][a-z0-9_]{1,62}$/;
const ISO=/^20\d{2}-\d{2}-\d{2}$/;
export function buildSalesDetailSQL(schema){
 if(!VALID.test(schema))throw Error("Esquema no permitido");
 const t='"'+schema+'"';
 const unitCost=`(CASE WHEN co.priced_units>0 THEN co.cost/co.priced_units ELSE p.pmc END)`;
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
  LEFT JOIN LATERAL (
    SELECT a.codigo_nacional,a.nombre,a.familia,a.pmc FROM ${t}.articulos a
    WHERE upper(btrim(a.farmacia_codigo))=r.code
      AND a.origen_id=r.articulo_id
    ORDER BY a.sincronizado_en DESC NULLS LAST LIMIT 1
  ) a ON true
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
 page AS MATERIALIZED (
  SELECT "pharmacyId",cn,name,family,units,value,pmc,pvp,"abcdClass"
  FROM visible ORDER BY value DESC NULLS LAST,"pharmacyId",cn
  LIMIT $7::int OFFSET $8::int
 ),
 costs AS (
  SELECT c."pharmacyId",c.cn,
    sum(b.unidades*b.coste_unitario) FILTER(
     WHERE b.unidades>0 AND b.coste_unitario>0)::float8 AS cost,
    sum(b.unidades) FILTER(
     WHERE b.unidades>0 AND b.coste_unitario>0)::float8 AS priced_units
  FROM page p JOIN catalog c
    ON c."pharmacyId"=p."pharmacyId" AND c.cn=p.cn
  JOIN ${t}.compras b
    ON upper(btrim(b.farmacia_codigo))=c.code
       AND b.articulo_id=c.articulo_id
       AND b.fecha >= $1::date AND b.fecha < ($2::date+interval '1 day')
  GROUP BY c."pharmacyId",c.cn
 )
 SELECT p."pharmacyId",p.cn,p.name,p.family,p.units,p.value,p.pvp,p."abcdClass",
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
 ORDER BY p.value DESC NULLS LAST,p."pharmacyId",p.cn`;
}
export function setupSalesDetail(app,pool,{requireTenant}){
 app.get("/api/analytics/ventas/detalle",...requireTenant(),async(req,res,next)=>{
  try{
   if(req.context.role!=="superadministrador"&&
     !req.context.modules?.ventas&&!req.context.modules?.dashboard)
    return res.status(403).json({error:"Módulo de ventas no habilitado"});
   const from=String(req.query.desde||""),to=String(req.query.hasta||"");
   const raw=String(req.query.farmacias||""),search=String(req.query.buscar||"").trim();
   const families=String(req.query.familias||"").split(",").filter(Boolean);
   const page=Number(req.query.pagina||1);
   if(!approvedAnalysisRange(from,to,req.context.client.analysisMonths)||
     !Number.isSafeInteger(page)||page<1||page>1000||
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
   const pageSize=200;
   const {rows}=await pool.query(buildSalesDetailSQL(schema),
    [from,to,ids.map(id=>byId.get(id)),ids.map(String),search,families,
     pageSize+1,(page-1)*pageSize]);
   res.json({products:rows.slice(0,pageSize).map(x=>({
    ...x,id:x.pharmacyId+"|"+x.cn,pharmacyId:String(x.pharmacyId)
   })),hasMore:rows.length>pageSize,page,from,to});
  }catch(e){next(e)}
 });
}
