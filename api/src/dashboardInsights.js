// Análisis independientes para Inicio: agregados reales, autorizados por farmacia.
// No se envían tickets ni líneas brutas al navegador.
import {getFilters} from "./realReports.js";
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
import {includedPurchaseSupplier} from "./supplierReporting.js";
import {nameCommercialRows} from "./commercialNames.js";
import {nameArticleRows} from "./articleNames.js";

const SCHEMA=/^[a-z][a-z0-9_]{1,62}$/;
function scope(req,res){
 const request={...req,query:{...req.query,modulo:"dashboard",orden:undefined,direccion:undefined}};
 const f=getFilters(request,res);
 if(!f)return null;
 if(f.search||f.families.length){
  res.status(400).json({error:"Este análisis solo admite período y farmacias"});
  return null;
 }
 if(!SCHEMA.test(req.context.client.schema)) {
  res.status(400).json({error:"Esquema no válido"});
  return null;
 }
 return f;
}
function salesFrom(req){
 const q='"'+req.context.client.schema+'"';
 return " FROM "+q+".fm_ventas_analitica v JOIN farmetrica.farmacias f"+
  " ON f.cliente_slug=$4 AND upper(btrim(v.farmacia_codigo))="+pharmacyDataCodeSQL("f")+
  " WHERE v.fecha >= $1::date AND v.fecha < $2::date+interval '1 day'"+
  " AND f.id=ANY($3::int[])";
}
function params(req,f){return [f.from,f.to,f.ids,req.context.client.slug]}
export function setupDashboardInsights(app,pool,{requireTenant}){
 const access=[...requireTenant(),(req,res,next)=>{
  if(req.context.role==="superadministrador"||req.context.modules.dashboard)return next();
  res.status(403).json({error:"Inicio no habilitado"});
 }];
 app.get("/api/analytics/dashboard/horarios",...access,async(req,res,next)=>{
  const f=scope(req,res);if(!f)return;
  if(!f.ids.length)return res.json({cells:[],total:0});
  try{
   const {rows}=await pool.query(
    "SELECT extract(isodow FROM v.fecha)::int AS weekday,"+
    " extract(hour FROM v.fecha)::int AS hour,"+
    " sum(v.importe)::float8 AS sales,count(*)::int AS lines"+
    salesFrom(req)+" GROUP BY 1,2 ORDER BY 1,2",params(req,f));
   res.json({cells:rows,total:rows.reduce((n,r)=>n+Number(r.sales||0),0)});
  }catch(e){next(e)}
 });
 app.get("/api/analytics/dashboard/vendedores",...access,async(req,res,next)=>{
  const f=scope(req,res);if(!f)return;
  if(!f.ids.length)return res.json({sellers:[],total:0});
  try{
   const {rows}=await pool.query(
    "SELECT f.id::text AS \"pharmacyId\",v.vendedor_id::text AS \"sellerId\","+
    " sum(v.importe)::float8 AS sales,sum(v.unidades)::float8 AS units"+
    salesFrom(req)+" GROUP BY f.id,v.vendedor_id ORDER BY sales DESC",
    params(req,f));
   const named=await nameCommercialRows(pool,req.context,rows);
   const result=new Map();
   for(const row of named){
    // El mismo ID de vendedor puede pertenecer a personas distintas en cada farmacia.
    const label=row.sellerId==null||!String(row.sellerId).trim()?
     "Sin vendedor":row.sellerName||String(row.sellerId);
    const key=label.trim().toLocaleUpperCase("es");
    const v=result.get(key)||{name:label,sales:0,units:0};
    v.sales+=Number(row.sales||0);v.units+=Number(row.units||0);
    result.set(key,v);
   }
   const sellers=[...result.values()].sort((a,b)=>b.sales-a.sales);
   res.json({sellers,total:sellers.reduce((n,r)=>n+r.sales,0)});
  }catch(e){next(e)}
 });
 app.get("/api/analytics/dashboard/canales-compra",...access,async(req,res,next)=>{
  const f=scope(req,res);if(!f)return;
  const empty={available:true,channels:[],comparisons:[],matchedArticles:0,pricedLines:0};
  if(!f.ids.length)return res.json(empty);
  try{
   const schema=req.context.client.schema,q='"'+schema+'"';
   const {rows:metadata}=await pool.query(
    "SELECT column_name FROM information_schema.columns"+
    " WHERE table_schema=$1 AND table_name='fm_recepciones_analitica'",[schema]);
   const names=new Set(metadata.map(r=>r.column_name));
   const has=(...fields)=>fields.every(field=>names.has(field));
   const normalized=has("farmacia_codigo","fecha","articulo_id","proveedor_id","unidades","coste_unitario");
   const legacy=!normalized&&has("farmacia_id","fecha","producto_id","proveedor_id","unidades","puc");
   if(!normalized&&!legacy)return res.json({...empty,available:false,
    reason:"No se dispone de líneas de compra con artículo y PUC"});
   const join=legacy?
    " JOIN farmetrica.farmacias f ON f.id=t.farmacia_id AND f.cliente_slug=$4":
    " JOIN farmetrica.farmacias f ON f.cliente_slug=$4"+
    " AND upper(btrim(t.farmacia_codigo))="+pharmacyDataCodeSQL("f");
   const article=legacy?"t.producto_id":"t.articulo_id";
   const unit=legacy?"t.puc":"t.coste_unitario";
   const included=includedPurchaseSupplier({tenant:"$4",code:"t.proveedor_id",
    name:names.has("proveedor_nombre")?"t.proveedor_nombre":null});
   const base=" WITH classified AS (SELECT f.id::text AS pharmacy_id,"+
    " btrim("+article+"::text) AS article, t.unidades::numeric AS units,"+
    " "+unit+"::numeric AS puc,"+
    " CASE WHEN pm.cooperativa=true THEN 'cooperativa'"+
    " WHEN pm.tipo='laboratorio' THEN 'laboratorio' ELSE 'sin_clasificar' END AS channel"+
    " FROM "+q+".fm_recepciones_analitica t"+join+
    " LEFT JOIN farmetrica.proveedores_maestro pm"+
    " ON pm.cliente_slug=$4 AND upper(btrim(pm.codigo_origen))=upper(btrim(t.proveedor_id::text))"+
    " WHERE t.fecha >= $1::date AND t.fecha < $2::date+interval '1 day'"+
    " AND f.id=ANY($3::int[]) AND t.unidades>0"+
    " AND nullif(btrim("+article+"::text),'') IS NOT NULL"+
    " AND "+included+" ), priced AS (SELECT * FROM classified WHERE puc IS NOT NULL AND puc>=0)";
   const values=params(req,f);
   const [channelsResult,detailResult]=await Promise.all([
    pool.query(base+" SELECT channel,sum(units*puc)::float8 AS value,"+
      " sum(units)::float8 AS units,count(*)::int AS lines"+
      " FROM priced GROUP BY channel",values),
    pool.query(base+
     " , grouped AS (SELECT pharmacy_id,article,channel,"+
     " sum(units*puc)/nullif(sum(units),0) AS avg_puc,sum(units) AS units"+
     " FROM priced WHERE channel IN ('cooperativa','laboratorio')"+
     " GROUP BY pharmacy_id,article,channel)"+
     " SELECT pharmacy_id AS \"pharmacyId\",article AS \"articleId\","+
     " max(avg_puc) FILTER(WHERE channel='cooperativa')::float8 AS \"coopPuc\","+
     " max(avg_puc) FILTER(WHERE channel='laboratorio')::float8 AS \"labPuc\","+
     " max(units) FILTER(WHERE channel='cooperativa')::float8 AS \"coopUnits\","+
     " max(units) FILTER(WHERE channel='laboratorio')::float8 AS \"labUnits\""+
     " FROM grouped GROUP BY pharmacy_id,article"+
     " HAVING count(DISTINCT channel)=2"+
     " ORDER BY abs(max(avg_puc) FILTER(WHERE channel='cooperativa')-"+
     " max(avg_puc) FILTER(WHERE channel='laboratorio'))*"+
     " CASE WHEN max(avg_puc) FILTER(WHERE channel='cooperativa')>"+
     " max(avg_puc) FILTER(WHERE channel='laboratorio')"+
     " THEN max(units) FILTER(WHERE channel='cooperativa')"+
     " ELSE max(units) FILTER(WHERE channel='laboratorio') END DESC NULLS LAST"+
     " LIMIT 80",values)
   ]);
   const named=await nameArticleRows(pool,req.context,detailResult.rows);
   const comparisons=named.map(row=>{
    const diff=Number(row.coopPuc)-Number(row.labPuc);
    const expensiveUnits=diff>0?Number(row.coopUnits):Number(row.labUnits);
    return {...row,coopPuc:Number(row.coopPuc),labPuc:Number(row.labPuc),
     difference:diff,differencePct:row.coopPuc>0?100*diff/row.coopPuc:null,
     potentialSaving:Math.abs(diff)*expensiveUnits};
   });
   const channels=channelsResult.rows.map(row=>({...row,
    value:Number(row.value),units:Number(row.units)}));
   res.json({available:true,channels,comparisons,
    matchedArticles:comparisons.length,comparisonLimit:80,
    pricedLines:channels.reduce((n,r)=>n+Number(r.lines||0),0)});
  }catch(e){next(e)}
 });
}
