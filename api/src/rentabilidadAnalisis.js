// Rentabilidad consolidada: una sola fuente de ventas y un mismo PMC por
// farmacia/artículo en el resumen, producto y detalle. Solo lectura y tenant-scoped.
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
const IDENT=/^[a-z][a-z0-9_]{1,62}$/;
const ISO=/^\d{4}-\d{2}-\d{2}$/;
const SORT={sales:'sales',margin:'margin',units:'units',name:'name',family:'family',cn:'cn'};
const validDate=value=>{
 if(!ISO.test(value))return false;
 const d=new Date(value+"T00:00:00Z");
 return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===value;
};
function scope(req,res){
 if(req.context.role!=="superadministrador"&&req.context.modules?.rentabilidad!==true){
  res.status(403).json({error:"Módulo de rentabilidad no habilitado"});return null;
 }
 const from=String(req.query.desde||""),to=String(req.query.hasta||"");
 const selection=String(req.query.farmacias||""),search=String(req.query.buscar||"").trim();
 const page=Number(req.query.pagina||1),size=Number(req.query.tamano||50);
 const order=String(req.query.orden||"sales"),direction=String(req.query.direccion||"desc").toLowerCase();
 if(!validDate(from)||!validDate(to)||from>to||Date.parse(to)-Date.parse(from)>366*86400000||
  selection.length>2000||search.length>100||page<1||!Number.isSafeInteger(page)||page>1000||
  ![25,50,100].includes(size)||!Object.hasOwn(SORT,order)||!["asc","desc"].includes(direction)||
  (selection&&selection.split(",").some(id=>!/^[1-9]\d{0,8}$/.test(id)))){
  res.status(400).json({error:"Filtros de rentabilidad no válidos"});return null;
 }
 const allowed=(req.context.allowedPharmacyIds||[]).map(Number);
 const ids=[...new Set(selection?selection.split(",").map(Number):allowed)];
 if(ids.some(id=>!allowed.includes(id))){
  res.status(403).json({error:"Farmacia no autorizada"});return null;
 }
 const schema=String(req.context.client?.schema||"");
 if(!IDENT.test(schema))throw Error("Esquema de cliente no válido");
 return {from,to,ids,schema,slug:req.context.client.slug,search,page,size,order,direction};
}
function articleColumns(columns){
 const col=(key,type="text")=>columns.has(key)?"a."+key:"NULL::"+type;
 return {name:col("nombre"),cn:col("codigo_nacional"),family:col("familia"),
  pmc:col("pmc","numeric"),pvp:col("pvp","numeric"),
  stock:col("stock_actual","numeric"),laboratory:col("laboratorio"),
  updated:columns.has("sincronizado_en")?"ORDER BY a.sincronizado_en DESC NULLS LAST":""};
}
function enrichedCTE(schema,columns,view){
 if(!IDENT.test(schema)||!["overview","products","sales"].includes(view))throw Error("Vista inválida");
 const q='"'+schema+'"',c=articleColumns(columns),pharmacy=pharmacyDataCodeSQL("f");
 const period=view==="overview";
 const from=period?[
  "WITH raw AS MATERIALIZED (",
  " SELECT f.id::text AS \"pharmacyId\",f.nombre AS \"pharmacyName\",",
  " upper(btrim(v.farmacia_codigo)) AS code,v.articulo_id AS \"articleId\",",
  " date_trunc('month',v.fecha)::date AS month,",
  " sum(v.unidades)::numeric AS units,sum(v.importe)::numeric AS sales",
  " FROM "+q+".fm_ventas_analitica v",
  " JOIN farmetrica.farmacias f ON f.cliente_slug=$4",
  " AND upper(btrim(v.farmacia_codigo))="+pharmacy+" AND f.id=ANY($3::int[])",
  " WHERE v.fecha >= $1::date AND v.fecha < $2::date+interval '1 day'",
  " GROUP BY f.id,f.nombre,upper(btrim(v.farmacia_codigo)),v.articulo_id,date_trunc('month',v.fecha)::date",
  ")"
 ]:view==="products"?[
  "WITH raw AS MATERIALIZED (",
  " SELECT f.id::text AS \"pharmacyId\",f.nombre AS \"pharmacyName\",",
  " upper(btrim(v.farmacia_codigo)) AS code,v.articulo_id AS \"articleId\",",
  " sum(v.unidades)::numeric AS units,sum(v.importe)::numeric AS sales",
  " FROM "+q+".fm_ventas_analitica v",
  " JOIN farmetrica.farmacias f ON f.cliente_slug=$4",
  " AND upper(btrim(v.farmacia_codigo))="+pharmacy+" AND f.id=ANY($3::int[])",
  " WHERE v.fecha >= $1::date AND v.fecha < $2::date+interval '1 day'",
  " AND nullif(btrim(v.articulo_id),'') IS NOT NULL",
  " GROUP BY f.id,f.nombre,upper(btrim(v.farmacia_codigo)),v.articulo_id",
  ")"
 ]:[
  "WITH raw AS MATERIALIZED (",
  " SELECT f.id::text AS \"pharmacyId\",f.nombre AS \"pharmacyName\",",
  " upper(btrim(v.farmacia_codigo)) AS code,v.articulo_id AS \"articleId\",",
  " v.fecha AS \"at\",coalesce(nullif(v.numero_ticket,''),v.documento_id) AS ticket,",
  " v.documento_id AS \"documentId\",v.linea_id AS \"lineId\",",
  " v.unidades::numeric AS units,v.importe::numeric AS sales,",
  " v.precio_unitario::numeric AS \"unitPrice\",",
  " v.descuento_linea::numeric AS discount,",
  " v.coste_historico::numeric AS \"historicalCost\"",
  " FROM "+q+".fm_ventas_analitica v",
  " JOIN farmetrica.farmacias f ON f.cliente_slug=$4",
  " AND upper(btrim(v.farmacia_codigo))="+pharmacy+" AND f.id=ANY($3::int[])",
  " WHERE v.fecha >= $1::date AND v.fecha < $2::date+interval '1 day'",
  " AND ($5::text='' OR v.articulo_id ILIKE '%'||$5||'%' OR",
  " coalesce(v.numero_ticket,'') ILIKE '%'||$5||'%' OR",
  " v.documento_id ILIKE '%'||$5||'%')",
  " ORDER BY v.fecha DESC,v.documento_id DESC,v.linea_id DESC",
  " LIMIT $6::int OFFSET $7::int",
  ")"
 ];
 return from.concat([
  ", enriched AS MATERIALIZED (",
  " SELECT r.*,coalesce(nullif(btrim(a.name),''),r.\"articleId\",'Artículo sin identificar') AS name,",
  " coalesce(nullif(btrim(a.cn),''),r.\"articleId\") AS cn,",
  " coalesce(nullif(btrim(global_family.nombre),''),'Sin clasificar') AS family,",
  " a.laboratory,a.pmc,a.pvp,a.stock,",
  " CASE WHEN a.pmc>0 THEN r.sales ELSE NULL END AS \"coveredSales\",",
  " CASE WHEN a.pmc>0 THEN r.units*a.pmc ELSE NULL END AS cost,",
  " CASE WHEN a.pmc>0 THEN r.sales-r.units*a.pmc ELSE NULL END AS margin",
  " FROM raw r",
  " LEFT JOIN LATERAL (",
  " SELECT "+c.name+" AS name,"+c.cn+" AS cn,"+c.family+" AS family,",
  " "+c.pmc+" AS pmc,"+c.pvp+" AS pvp,"+c.stock+" AS stock,"+c.laboratory+" AS laboratory",
  " FROM "+q+".articulos a",
  " WHERE upper(btrim(a.farmacia_codigo))=r.code AND a.origen_id=r.\"articleId\"",
  " "+c.updated+" LIMIT 1",
  " ) a ON true",
  " LEFT JOIN farmetrica.familias_globales_articulos linked",
  " ON linked.cliente_slug=$4 AND linked.farmacia_codigo=r.code",
  " AND linked.articulo_origen_id=r.\"articleId\"",
  " LEFT JOIN farmetrica.familias_globales_alias local_alias",
  " ON local_alias.cliente_slug=$4 AND local_alias.farmacia_codigo=r.code",
  " AND local_alias.codigo_origen=nullif(btrim(a.family),'')",
  " LEFT JOIN farmetrica.familias_globales origin_family",
  " ON origin_family.cliente_slug=$4",
  " AND origin_family.id=coalesce(linked.familia_id,local_alias.familia_id)",
  " LEFT JOIN farmetrica.familias_globales global_family",
  " ON global_family.cliente_slug=$4",
  " AND global_family.id=coalesce(origin_family.fusionado_a,origin_family.id)",
  " AND global_family.activo",
  ")"
 ]).join("\n");
}
export function buildProfitabilitySQL(schema,columns,view,order="sales",direction="desc"){
 if(!Object.hasOwn(SORT,order)||!["asc","desc"].includes(direction))throw Error("Ordenación inválida");
 const base=enrichedCTE(schema,columns,view);
 if(view==="overview")return base+"\n"+[
  "SELECT CASE WHEN GROUPING(month)=0 THEN 'month'",
  " WHEN GROUPING(\"pharmacyId\")=0 THEN 'pharmacy' ELSE 'family' END AS kind,",
  " month::text AS bucket,\"pharmacyId\",\"pharmacyName\",family,",
  " sum(sales)::float8 AS sales,sum(units)::float8 AS units,",
  " sum(\"coveredSales\")::float8 AS \"coveredSales\",",
  " sum(cost)::float8 AS cost,sum(margin)::float8 AS margin",
  " FROM enriched",
  " GROUP BY GROUPING SETS ((month),(\"pharmacyId\",\"pharmacyName\"),(family))",
  " ORDER BY kind,bucket,\"pharmacyName\",margin DESC NULLS LAST"
 ].join("\n");
 if(view==="products")return base+"\n"+[
  "SELECT *,count(*) OVER()::int AS total",
  " FROM enriched WHERE ($5::text='' OR cn ILIKE '%'||$5||'%'",
  " OR name ILIKE '%'||$5||'%' OR family ILIKE '%'||$5||'%'",
  " OR \"pharmacyName\" ILIKE '%'||$5||'%')",
  " ORDER BY "+SORT[order]+" "+direction.toUpperCase()+" NULLS LAST,cn,\"pharmacyId\"",
  " LIMIT $6::int OFFSET $7::int"
 ].join("\n");
 return base+"\n"+[
  "SELECT * FROM enriched",
  " ORDER BY \"at\" DESC,\"documentId\" DESC,\"lineId\" DESC"
 ].join("\n");
}
export function setupProfitability(app,pool,{requireTenant}){
 app.get("/api/analytics/rentabilidad/:view",...requireTenant(),async(req,res,next)=>{
  const view=String(req.params.view||"");
  if(!["overview","products","sales"].includes(view))
   return res.status(404).json({error:"Vista no disponible"});
  try{
   const f=scope(req,res);if(!f)return;
   if(!f.ids.length)return res.json({available:true,rows:[],total:0,hasMore:false});
   const {rows:fields}=await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='articulos'",[f.schema]);
   const columns=new Set(fields.map(r=>r.column_name));
   if(!["farmacia_codigo","origen_id","nombre"].every(c=>columns.has(c)))
    return res.json({available:false,rows:[],message:"Catálogo de artículos pendiente de sincronización."});
   const sql=buildProfitabilitySQL(f.schema,columns,view,f.order,f.direction);
   const limit=view==="sales"?f.size+1:f.size;
   const values=view==="overview"?[f.from,f.to,f.ids,f.slug]:
    [f.from,f.to,f.ids,f.slug,f.search,limit,(f.page-1)*f.size];
   const result=await pool.query({text:sql,values,query_timeout:27000});
   const rows=view==="sales"?result.rows.slice(0,f.size):result.rows;
   res.json({available:true,rows,
    total:view==="products"?Number(rows[0]?.total||0):null,
    page:f.page,pageSize:f.size,
    hasMore:view==="sales"&&result.rows.length>f.size,
    costMethod:"PMC actual del catálogo; margen estimado, no beneficio contable."});
  }catch(error){if(error.status)return res.status(error.status).json({error:error.message});next(error);}
 });
}
