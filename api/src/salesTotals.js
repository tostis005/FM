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
 // Para 12/6/3 meses basta un GROUP BY mensual. La ventana suma solo los
 // 12 resultados agregados y evita GROUPING SETS y una segunda lectura.
 if(granularity==="month")return `
 SELECT to_char(date_trunc('month',v.fecha),'YYYY-MM') AS month,
   sum(v.importe)::float8 AS ventas,sum(v.unidades)::float8 AS unidades,
   sum(sum(v.importe)) OVER()::float8 AS total_ventas,
   sum(sum(v.unidades)) OVER()::float8 AS total_unidades
 FROM ${table}.ventas v
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
   coalesce(sum(unidades),0)::float8 AS unidades
 FROM (
   SELECT date_trunc('month',v.fecha) AS mes,
     date_trunc('${granularity}',v.fecha) AS periodo,
     v.importe,v.unidades
   FROM ${table}.ventas v
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
     kpis:{ventas:0,unidades:0}});
   const {rows}=await pool.query(buildSalesTotalsSql(schema,granularity),
     [from,to,codes]);
   const months=(granularity==="month"?rows:rows.filter(x=>x.tipo==="month")).map(x=>({
    month:x.month,ventas:Number(x.ventas),unidades:Number(x.unidades)}));
   const series=granularity==="month"?
    months.map(x=>({bucket:x.month,ventas:x.ventas,unidades:x.unidades})):
    rows.filter(x=>x.tipo==="series").map(x=>({
     bucket:x.bucket,ventas:Number(x.ventas),unidades:Number(x.unidades)}));
   const total=granularity==="month"?
    {ventas:rows[0]?.total_ventas,unidades:rows[0]?.total_unidades}:
    rows.find(x=>x.tipo==="total");
   res.json({from,to,granularity,monthly:months,series,
     kpis:{ventas:Number(total?.ventas||0),unidades:Number(total?.unidades||0)}});
  }catch(e){next(e)}
 });
}
