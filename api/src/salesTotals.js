// Consulta ligera: SUM y GROUPING SETS sobre ventas, sin catálogo ni compras.
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
const dateRx=/^20\d{2}-\d{2}-\d{2}$/;
function validDate(s){
 if(!dateRx.test(s))return false;
 const d=new Date(s+"T00:00:00Z");
 return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===s;
}
export function buildSalesTotalsSql(schema,granularity){
 if(!/^[a-z][a-z0-9_]{1,62}$/.test(schema)||!["hour","day","month"].includes(granularity))
  throw Error("Parámetro SQL no válido");
 const table='"'+schema+'"';
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
   FROM ${table}.ventas v JOIN farmetrica.farmacias f
     ON f.cliente_slug=$4
       AND upper(btrim(v.farmacia_codigo))=${pharmacyDataCodeSQL("f")}
   WHERE f.id=ANY($3::int[])
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
     Date.parse(to)-Date.parse(from)>366*86400000||
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
   const schema=req.context.client.schema;
   if(!/^[a-z][a-z0-9_]{1,62}$/.test(schema))throw Error("Esquema no válido");
   if(!ids.length)return res.json({from,to,granularity,monthly:[],series:[],
     kpis:{ventas:0,unidades:0}});
   const {rows}=await pool.query(buildSalesTotalsSql(schema,granularity),
     [from,to,ids,req.context.client.slug]);
   const months=rows.filter(x=>x.tipo==="month").map(x=>({
    month:x.month,ventas:Number(x.ventas),unidades:Number(x.unidades)}));
   const series=granularity==="month"?
    months.map(x=>({bucket:x.month,ventas:x.ventas,unidades:x.unidades})):
    rows.filter(x=>x.tipo==="series").map(x=>({
     bucket:x.bucket,ventas:Number(x.ventas),unidades:Number(x.unidades)}));
   const total=rows.find(x=>x.tipo==="total");
   res.json({from,to,granularity,monthly:months,series,
     kpis:{ventas:Number(total?.ventas||0),unidades:Number(total?.unidades||0)}});
  }catch(e){next(e)}
 });
}
