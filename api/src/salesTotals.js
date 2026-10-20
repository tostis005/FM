// Consulta ligera: SUM y GROUPING SETS sobre ventas, sin catálogo ni compras.
const dateRx=/^(?:19|20)\d{2}-\d{2}-\d{2}$/;
function validDate(s){
 if(!dateRx.test(s))return false;
 const d=new Date(s+"T00:00:00Z");
 return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===s;
}
export function buildSalesTotalsSql(schema,granularity){
 if(!/^[a-z][a-z0-9_]{1,62}$/.test(schema)||!["hour","day","month"].includes(granularity))
  throw Error("Parámetro SQL no válido");
 const table='"'+schema+'"';
 // Las líneas especiales sin artículo suman importe, pero no unidades de producto.
 const productUnits="coalesce(sum(v.unidades) FILTER (WHERE nullif(btrim(v.articulo_id),'') IS NOT NULL),0)";
 const product="nullif(btrim(v.articulo_id),'') IS NOT NULL";
 const costed=`${product} AND v.coste_historico IS NOT NULL AND v.coste_historico>=0`;
 const marginExpr=`coalesce(sum(v.importe-v.unidades*v.coste_historico) FILTER (WHERE ${costed}),0)`;
 const salesCostedExpr=`coalesce(sum(v.importe) FILTER (WHERE ${costed}),0)`;
 const pricedExpr=`count(*) FILTER (WHERE ${costed})`;
 const productCountExpr=`count(*) FILTER (WHERE ${product})`;
 // Para 12/6/3 meses basta un GROUP BY mensual. La ventana suma solo los
 // 12 resultados agregados y evita GROUPING SETS y una segunda lectura.
 if(granularity==="month")return `
 SELECT to_char(date_trunc('month',v.fecha),'YYYY-MM') AS month,
   sum(v.importe)::float8 AS ventas,${productUnits}::float8 AS unidades,
   sum(sum(v.importe)) OVER()::float8 AS total_ventas,
   sum(${productUnits}) OVER()::float8 AS total_unidades,
   sum(${marginExpr}) OVER()::float8 AS total_margen,
   sum(${salesCostedExpr}) OVER()::float8 AS total_ventas_con_coste,
   sum(${pricedExpr}) OVER()::bigint AS total_lineas_con_coste,
   sum(${productCountExpr}) OVER()::bigint AS total_lineas_producto
 FROM ${table}.fm_ventas_analitica v
 WHERE upper(btrim(v.farmacia_codigo))=ANY($3::text[])
   AND v.fecha >= $1::date AND v.fecha < ($2::date+interval '1 day')
 GROUP BY date_trunc('month',v.fecha)
 ORDER BY month`;
 const fmt=granularity==="hour"?'YYYY-MM-DD"T"HH24:MI':granularity==="day"?"YYYY-MM-DD":"YYYY-MM";
 const sets=granularity==="month"?"((mes),())":"((mes),(periodo),())";
 return `
 SELECT CASE WHEN GROUPING(mes)=0 THEN 'month'
   ${granularity==="month"?"":"WHEN GROUPING(periodo)=0 THEN 'series'"} ELSE 'total' END AS tipo,
   to_char(mes,'YYYY-MM') AS month,
   ${granularity==="month"?"NULL::text":"to_char(periodo,'"+fmt+"')"} AS bucket,
   coalesce(sum(importe),0)::float8 AS ventas,
   coalesce(sum(unidades),0)::float8 AS unidades,
   coalesce(sum(margin),0)::float8 AS margen,
   coalesce(sum(sales_with_cost),0)::float8 AS ventas_con_coste,
   coalesce(sum(costed_count),0)::bigint AS lineas_con_coste,
   coalesce(sum(product_count),0)::bigint AS lineas_producto
 FROM (
   SELECT date_trunc('month',v.fecha) AS mes,
     date_trunc('${granularity}',v.fecha) AS periodo,
     v.importe,CASE WHEN ${product} THEN v.unidades ELSE 0 END AS unidades,
     CASE WHEN ${costed} THEN v.importe-v.unidades*v.coste_historico ELSE 0 END AS margin,
     CASE WHEN ${costed} THEN v.importe ELSE 0 END AS sales_with_cost,
     CASE WHEN ${costed} THEN 1 ELSE 0 END AS costed_count,
     CASE WHEN ${product} THEN 1 ELSE 0 END AS product_count
   FROM ${table}.fm_ventas_analitica v
   WHERE upper(btrim(v.farmacia_codigo))=ANY($3::text[])
     AND v.fecha >= $1::date
     AND v.fecha < ($2::date + interval '1 day')
 ) movimientos
 GROUP BY GROUPING SETS ${sets}
 ORDER BY tipo,mes${granularity==="month"?"":",periodo"}`;
}
export function setupSalesTotals(app,pool,{requireTenant}){
 app.get("/api/analytics/ventas/totales",...requireTenant(),async(req,res,next)=>{
  try{
   if(req.context.role!=="superadministrador"&&
     !req.context.modules?.ventas&&!req.context.modules?.dashboard)
    return res.status(403).json({error:"Módulo de ventas no habilitado"});
   const from=String(req.query.desde||""),to=String(req.query.hasta||"");
   const raw=String(req.query.farmacias||"");
   const granularity=String(req.query.granularidad||"month");
   if(!validDate(from)||!validDate(to)||from>to||
     Date.parse(to)-Date.parse(from)>73050*86400000||
     raw.length>2000||!["hour","day","month"].includes(granularity)||
     (raw&&raw.split(",").some(n=>!/^[1-9]\d{0,8}$/.test(n))))
    return res.status(400).json({error:"Fechas o farmacias no válidas"});
   if(req.query.buscar||req.query.familias)
    return res.status(400).json({error:"Consulta de totales incompatible con filtros de artículo"});
   const allowed=req.context.allowedPharmacyIds.map(Number);
   const requested=raw?raw.split(",").map(Number):allowed;
   if(requested.some(id=>!allowed.includes(id)))
    return res.status(403).json({error:"Farmacia no autorizada"});
   const ids=[...new Set(requested)];
   // Los códigos reales vienen EXCLUSIVAMENTE del contexto autorizado de la
   // sesión (p.ej. Valdemarías: visible POL -> ERP VAL). Nunca del navegador.
   const codeById=new Map((req.context.pharmacies||[]).map(p=>[
    Number(p.id),String(p.databaseCode||p.sourceCode||"").trim().toUpperCase()]));
   const codes=[...new Set(ids.map(id=>codeById.get(id)).filter(Boolean))];
   if(ids.length&&!codes.length)return res.status(503).json({error:"No hay códigos ERP para las farmacias autorizadas"});
   if(ids.some(id=>!codeById.get(id)))return res.status(503).json({error:"Falta correspondencia ERP de una farmacia"});
   const schema=req.context.client.schema;
   if(!/^[a-z][a-z0-9_]{1,62}$/.test(schema))throw Error("Esquema no válido");
   if(!ids.length)return res.json({from,to,granularity,monthly:[],series:[],
     costBasis:{products:0,priced:0,coveredSales:0,margin:0},
     kpis:{ventas:0,unidades:0,margen:null,margenPct:null,coberturaCostes:null}});
   // Siempre leer PostgreSQL: sin cachés de importes ni series.
   const {rows}=await pool.query(buildSalesTotalsSql(schema,granularity),[from,to,codes]);
   const months=(granularity==="month"?rows:rows.filter(x=>x.tipo==="month")).map(x=>({
    month:x.month,ventas:Number(x.ventas),unidades:Number(x.unidades)}));
   const series=granularity==="month"?
    months.map(x=>({bucket:x.month,ventas:x.ventas,unidades:x.unidades})):
    rows.filter(x=>x.tipo==="series").map(x=>({
     bucket:x.bucket,ventas:Number(x.ventas),unidades:Number(x.unidades)}));
   // En el agregado mensual los costes/márgenes llegan en columnas WINDOW
   // total_*; no están en las columnas del mes individual. Si no se copian,
   // los KPI de margen se convierten erróneamente en «sin datos».
   const total=granularity==="month"?
    {ventas:rows[0]?.total_ventas,unidades:rows[0]?.total_unidades,
     total_margen:rows[0]?.total_margen,
     total_ventas_con_coste:rows[0]?.total_ventas_con_coste,
     total_lineas_con_coste:rows[0]?.total_lineas_con_coste,
     total_lineas_producto:rows[0]?.total_lineas_producto}:
    rows.find(x=>x.tipo==="total");
   const priced=Number(granularity==="month"?total?.total_lineas_con_coste:total?.lineas_con_coste)||0;
   const products=Number(granularity==="month"?total?.total_lineas_producto:total?.lineas_producto)||0;
   const gross=Number(granularity==="month"?total?.total_margen:total?.margen)||0;
   const coveredSales=Number(granularity==="month"?total?.total_ventas_con_coste:total?.ventas_con_coste)||0;
   const marginComplete=products>0&&priced===products;
   res.json({from,to,granularity,monthly:months,series,
     costBasis:{products,priced,coveredSales,margin:gross},
     kpis:{ventas:Number(total?.ventas||0),unidades:Number(total?.unidades||0),
       margen:marginComplete?Math.round(gross*100)/100:null,
       margenPct:marginComplete&&coveredSales!==0?Math.round(gross/coveredSales*10000)/100:null,
       coberturaCostes:products?Math.round(priced/products*10000)/100:null}});
  }catch(e){next(e)}
 });
}
