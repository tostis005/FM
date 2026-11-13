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
 const family=String(req.query.familia||"").trim();
 const page=Number(req.query.pagina||1),size=Number(req.query.tamano||50);
 const order=String(req.query.orden||"sales"),direction=String(req.query.direccion||"desc").toLowerCase();
 if(!validDate(from)||!validDate(to)||from>to||Date.parse(to)-Date.parse(from)>366*86400000||
  selection.length>2000||search.length>100||family.length>160||page<1||!Number.isSafeInteger(page)||page>1000||
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
 return {from,to,ids,schema,slug:req.context.client.slug,search,family,page,size,order,direction};
}
function articleColumns(columns){
 const col=(key,type="text")=>columns.has(key)?"a."+key:"NULL::"+type;
 return {name:col("nombre"),cn:col("codigo_nacional"),family:col("familia"),
  pmc:col("pmc","numeric"),pvp:col("pvp","numeric"),
  stock:col("stock_actual","numeric"),laboratory:col("laboratorio"),
  updated:columns.has("sincronizado_en")?"ORDER BY a.sincronizado_en DESC NULLS LAST":""};
}
function enrichedCTE(schema,columns,view){
 if(!IDENT.test(schema))throw Error("Esquema SQL inválido");
 if(!["overview","products","sales"].includes(view))throw Error("Vista inválida");
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
  " AND ($8::text='' OR EXISTS (",
  " SELECT 1 FROM farmetrica.familias_globales_articulos link",
  " JOIN farmetrica.familias_globales fg",
  " ON fg.cliente_slug=link.cliente_slug AND fg.id=link.familia_id AND fg.activo",
  " WHERE link.cliente_slug=$4 AND link.farmacia_codigo=upper(btrim(v.farmacia_codigo))",
  " AND link.articulo_origen_id=v.articulo_id AND fg.nombre=$8::text",
  " ) OR ($8::text='Sin clasificar' AND NOT EXISTS (",
  " SELECT 1 FROM farmetrica.familias_globales_articulos unl",
  " JOIN farmetrica.familias_globales ufg ON ufg.cliente_slug=unl.cliente_slug",
  " AND ufg.id=unl.familia_id AND ufg.activo",
  " WHERE unl.cliente_slug=$4 AND unl.farmacia_codigo=upper(btrim(v.farmacia_codigo))",
  " AND unl.articulo_origen_id=v.articulo_id",
  " )))",
  " AND ($5::text='' OR v.articulo_id ILIKE '%'||$5||'%' OR",
  " coalesce(v.numero_ticket,'') ILIKE '%'||$5||'%' OR",
  " v.documento_id ILIKE '%'||$5||'%' OR EXISTS (",
  " SELECT 1 FROM "+q+".articulos search_article",
  " WHERE upper(btrim(search_article.farmacia_codigo))=upper(btrim(v.farmacia_codigo))",
  " AND search_article.origen_id=v.articulo_id",
  " AND (search_article.nombre ILIKE '%'||$5||'%'"+
   (columns.has("codigo_nacional")?" OR search_article.codigo_nacional ILIKE '%'||$5||'%'":"")+")",
  " ))",
  " ORDER BY v.fecha DESC,v.documento_id DESC,v.linea_id DESC",
  " LIMIT $6::int OFFSET $7::int",
  ")"
 ];
 if(period){
  // Agrupar por artículo/mes en raw, pero buscar el catálogo y la familia
  // una única vez por farmacia/artículo: antes se repetía por cada mes.
  return from.concat([
   ", article_keys AS MATERIALIZED (",
   " SELECT DISTINCT code,\"articleId\" FROM raw",
   " WHERE nullif(btrim(\"articleId\"),'') IS NOT NULL",
   ")",
   ", article_map AS MATERIALIZED (",
   " SELECT k.code,k.\"articleId\",art.pmc,",
   " coalesce(nullif(btrim(fam.nombre),''),'Sin clasificar') AS family",
   " FROM article_keys k",
   " LEFT JOIN LATERAL (",
   " SELECT "+c.pmc+" AS pmc FROM "+q+".articulos a",
   " WHERE upper(btrim(a.farmacia_codigo))=k.code AND a.origen_id=k.\"articleId\"",
   " "+c.updated+" LIMIT 1",
   " ) art ON true",
   " LEFT JOIN farmetrica.familias_globales_articulos linked",
   " ON linked.cliente_slug=$4 AND linked.farmacia_codigo=k.code",
   " AND linked.articulo_origen_id=k.\"articleId\"",
   " LEFT JOIN farmetrica.familias_globales fam",
   " ON fam.cliente_slug=linked.cliente_slug AND fam.id=linked.familia_id AND fam.activo",
   ")",
   ", enriched AS MATERIALIZED (",
   " SELECT r.*,coalesce(m.family,'Sin clasificar') AS family,",
   " CASE WHEN m.pmc>0 THEN r.sales ELSE NULL END AS \"coveredSales\",",
   " CASE WHEN m.pmc>0 THEN r.units*m.pmc ELSE NULL END AS cost,",
   " CASE WHEN m.pmc>0 THEN r.sales-r.units*m.pmc ELSE NULL END AS margin",
   " FROM raw r LEFT JOIN article_map m",
   " ON m.code=r.code AND m.\"articleId\"=r.\"articleId\"",
   ")"
  ]).join("\n");
 }
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
  // Exactamente el mismo enlace de artículo a familia que emplea Ventas.
  // Evitar joins de alias adicionales y grupos fusionados duplicados.
  " LEFT JOIN farmetrica.familias_globales_articulos linked",
  " ON linked.cliente_slug=$4 AND linked.farmacia_codigo=r.code",
  " AND linked.articulo_origen_id=r.\"articleId\"",
  " LEFT JOIN farmetrica.familias_globales global_family",
  " ON global_family.cliente_slug=linked.cliente_slug",
  " AND global_family.id=linked.familia_id AND global_family.activo",
  ")"
 ]).join("\n");
}
export function buildProfitabilitySQL(schema,columns,view,order="sales",direction="desc"){
 if(!Object.hasOwn(SORT,order)||!["asc","desc"].includes(direction))throw Error("Ordenación inválida");
 const base=enrichedCTE(schema,columns,view);
 if(view==="overview"){
  // Tres agregaciones explícitas del mismo conjunto materializado. Es más
  // fácil de comprobar que GROUPING SETS y conserva importes sin extrapolar.
  const sums="sum(sales)::float8 AS sales,sum(units)::float8 AS units,"+
   " sum(\"coveredSales\")::float8 AS \"coveredSales\","+
   " sum(cost)::float8 AS cost,sum(margin)::float8 AS margin";
  return base+"\n"+[
   ", scoped AS MATERIALIZED (",
   " SELECT * FROM enriched WHERE ($5::text='' OR family=$5::text)",
   ")",
   "SELECT 'month'::text AS kind,month::text AS bucket,",
   " NULL::text AS \"pharmacyId\",NULL::text AS \"pharmacyName\",",
   " NULL::text AS family,"+sums,
   " FROM scoped GROUP BY month",
   " UNION ALL",
   " SELECT 'pharmacy'::text AS kind,NULL::text AS bucket,",
   " \"pharmacyId\",\"pharmacyName\",NULL::text AS family,"+sums,
   " FROM scoped GROUP BY \"pharmacyId\",\"pharmacyName\"",
   " UNION ALL",
   " SELECT 'family'::text AS kind,NULL::text AS bucket,",
   " NULL::text AS \"pharmacyId\",NULL::text AS \"pharmacyName\",family,"+sums,
   " FROM scoped GROUP BY family",
   " ORDER BY kind,bucket,\"pharmacyName\",margin DESC NULLS LAST"
  ].join("\n");
 }
 if(view==="products")return base+"\n"+[
  "SELECT *,count(*) OVER()::int AS total",
  " FROM enriched WHERE ($8::text='' OR family=$8::text)",
  " AND ($5::text='' OR cn ILIKE '%'||$5||'%'",
  " OR name ILIKE '%'||$5||'%' OR laboratory ILIKE '%'||$5||'%')",
  " ORDER BY "+SORT[order]+" "+direction.toUpperCase()+" NULLS LAST,cn,\"pharmacyId\"",
  " LIMIT $6::int OFFSET $7::int"
 ].join("\n");
 return base+"\n"+[
  "SELECT * FROM enriched",
  " ORDER BY \"at\" DESC,\"documentId\" DESC,\"lineId\" DESC"
 ].join("\n");
}
export function setupProfitability(app,pool,{requireTenant}){
 // Caché de lectura efímera y compartimentada por cliente/farmacias/filtros.
 // Evita recalcular el resumen al regresar de otra pestaña y deduplica solicitudes.
 const overviewCache=new Map(),ttlMs=120000,maxEntries=32;
 app.get("/api/analytics/rentabilidad/familias",...requireTenant(),async(req,res,next)=>{
  try{
   if(req.context.role!=="superadministrador"&&req.context.modules?.rentabilidad!==true)
    return res.status(403).json({error:"Módulo de rentabilidad no habilitado"});
   const {rows}=await pool.query({
    text:"SELECT DISTINCT btrim(nombre) AS name FROM farmetrica.familias_globales"+
     " WHERE cliente_slug=$1 AND activo AND nullif(btrim(nombre),'') IS NOT NULL"+
     " ORDER BY name",
    values:[req.context.client.slug],query_timeout:9000
   });
   res.json({families:rows.map(row=>row.name)});
  }catch(error){next(error);}
 });
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
   const values=view==="overview"?[f.from,f.to,f.ids,f.slug,f.family]:
    [f.from,f.to,f.ids,f.slug,f.search,limit,(f.page-1)*f.size,f.family];
   let result;
   if(view==="overview"){
    const key=JSON.stringify([f.slug,f.schema,f.from,f.to,[...f.ids].sort((a,b)=>a-b),f.family]);
    const now=Date.now(),existing=overviewCache.get(key);
    if(existing&&existing.expires>now&&req.query.actualizar!=="1"){
     result=await existing.promise;
    }else{
     const promise=pool.query({text:sql,values,query_timeout:27000})
      .catch(error=>{if(overviewCache.get(key)?.promise===promise)overviewCache.delete(key);throw error;});
     overviewCache.delete(key);
     overviewCache.set(key,{promise,expires:now+ttlMs});
     if(overviewCache.size>maxEntries)overviewCache.delete(overviewCache.keys().next().value);
     result=await promise;
    }
   }else result=await pool.query({text:sql,values,query_timeout:27000});
   const rows=view==="sales"?result.rows.slice(0,f.size):result.rows;
   res.json({available:true,rows,
    total:view==="products"?Number(rows[0]?.total||0):null,
    page:f.page,pageSize:f.size,
    hasMore:view==="sales"&&result.rows.length>f.size,
    costMethod:"Coste unitario del catálogo (campo PMC); no equivale necesariamente al PUC de cada compra. Margen estimado."});
  }catch(error){
   // No convertir errores de SQL o timeouts en un aviso genérico imposible de diagnosticar.
   console.error("FM_RENTABILIDAD_CONSULTA",{
    vista:view,codigo:error.code||error.name,
    detalle:String(error.message||"").slice(0,250)
   });
   if(error.status)return res.status(error.status).json({error:error.message});
   if(error.code==="57014"||/timeout|timed out/i.test(String(error.message||"")))
    return res.status(503).json({error:"La consulta de rentabilidad tardó demasiado. Selecciona menos farmacias o un período más corto."});
   return res.status(503).json({error:"No se pudo consultar la rentabilidad. El servidor ha registrado el fallo para su revisión."});
  }
 });
}
