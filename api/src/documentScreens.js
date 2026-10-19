// Pantallas finales sobre documentos completos. Nunca utiliza datos de demostración.
// Todas las consultas se limitan al esquema y farmacias del cliente autenticado.
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
import {includedPurchaseSupplier} from "./supplierReporting.js";
import {nameCommercialRows,listCommercialSuppliers} from "./commercialNames.js";

const SCHEMA=/^[a-z][a-z0-9_]{1,62}$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
export const DOCUMENT_SECTIONS={
 "ventas-tickets":"ventas",
 "compras-recepciones":"compras",
 "stock-historico":"stock",
 "ventas-devoluciones":"ventas",
 "compras-devoluciones":"compras",
 "productos":"stock",
 "proveedores-condiciones":"proveedores",
 "rentabilidad-segmentos":"rentabilidad"
};
const ISO=value=>{
 const s=String(value||"");
 if(!DATE.test(s)||Number.isNaN(Date.parse(s+"T00:00:00Z"))||
   new Date(s+"T00:00:00Z").toISOString().slice(0,10)!==s)return null;
 return s;
};
const integer=value=>Math.max(0,Math.min(100000,Number(value)||0));
function parse(req){
 const {client,allowedPharmacyIds}=req.context;
 if(!SCHEMA.test(client.schema)||!SCHEMA.test(client.slug))throw Object.assign(Error("Cliente incorrecto"),{status:400});
 const from=ISO(req.query.desde||"2026-01-01");
 const to=ISO(req.query.hasta||new Date().toISOString().slice(0,10));
 if(!from||!to||from>to||Date.parse(to)-Date.parse(from)>366*10*86400000)
  throw Object.assign(Error("Período incorrecto"),{status:400});
 const raw=String(req.query.farmacias||"");
 if(raw.length>2500||raw&&raw.split(",").some(x=>!/^\d{1,9}$/.test(x)))
  throw Object.assign(Error("Farmacias incorrectas"),{status:400});
 const ids=raw?raw.split(",").map(Number):allowedPharmacyIds.map(Number);
 if(ids.some(id=>!allowedPharmacyIds.map(Number).includes(id)))
  throw Object.assign(Error("No tienes acceso a esa farmacia"),{status:403});
 const search=String(req.query.buscar||"").trim();
 if(search.length>100)throw Object.assign(Error("Búsqueda demasiado larga"),{status:400});
 const page=Number(req.query.pagina||1),size=Number(req.query.tamano||50);
 if(!Number.isInteger(page)||page<1||page>100000||![25,50,100].includes(size))
  throw Object.assign(Error("Página o tamaño incorrecto"),{status:400});
 return {from,to,ids:[...new Set(ids)],search,page,size,slug:client.slug,schema:client.schema};
}
const number=x=>x===null||x===undefined?null:Number(x);
function result(rows,f,section,note=""){
 const first=rows[0],{total=0,summaryValue=null,summaryUnits=null,summaryOther=null}=first||{};
 return {section,available:true,from:f.from,to:f.to,page:f.page,pageSize:f.size,
  total:Number(total),summary:{value:number(summaryValue),units:number(summaryUnits),other:number(summaryOther)},
  rows:rows.map(({total,summaryValue,summaryUnits,summaryOther,...row})=>row),
  note};
}
// Los SQL a continuación jamás reciben nombres de columnas ni tablas del navegador.
const pharmacyJoin=(alias="v")=>`JOIN farmetrica.farmacias f ON f.cliente_slug=$4
 AND upper(btrim(${alias}.farmacia_codigo))=${pharmacyDataCodeSQL("f")}
 AND f.id=ANY($3::int[])`;
const period=alias=>`${alias}.fecha >= $1::date AND ${alias}.fecha < $2::date+interval '1 day'`;
const slice="LIMIT $6::int OFFSET $7::int";
// Las cabeceras ordenan sobre TODO el conjunto antes de paginar.
export const DOCUMENT_SORT={
 "ventas-tickets":{at:'"at"',ticket:'"ticket"',lines:'"lines"',units:'"units"',amount:'"amount"'},
 "compras-recepciones":{at:'"at"',reference:'"reference"',supplier:'"supplierCode"',lines:'"lines"',units:'"units"',amount:'"amount"'},
 "stock-historico":{at:'"at"',pharmacy:'"pharmacyName"',sales:'"soldUnits"',purchases:'"receivedUnits"',net:'"documentedNetUnits"',tickets:'"tickets"',receipts:'"receipts"'},
 "ventas-devoluciones":{at:'v."at"',reference:'v.reference',units:'v.units',amount:'v.amount',kind:'v.kind'},
 "compras-devoluciones":{at:'v.fecha',reference:'v.numero_albaran',units:'v.unidades',amount:'v.importe',supplier:'v.proveedor_id'},
 "productos":{name:'name',sourceId:'"sourceId"',cn:'cn',family:'family',pvp:'pvp',pmc:'pmc',stock:'stock'},
 "proveedores-condiciones":{amount:'amount',units:'units',products:'products',receipts:'receipts',lastAt:'"lastAt"',supplier:'"supplierCode"'},
 "rentabilidad-segmentos":{sales:'sales',margin:'margin',units:'units',family:'family'}
};

export function buildDocumentScreenSQL(section,schema,columns=new Set(),order='default',direction='desc'){
 if(!SCHEMA.test(schema)||!Object.hasOwn(DOCUMENT_SECTIONS,section))throw Error("Pantalla o esquema inválido");
 const q='"'+schema+'"', join=pharmacyJoin("v"), range=period("v");
 const mapping=DOCUMENT_SORT[section],defaultKey={
  "ventas-tickets":"at","compras-recepciones":"at","ventas-devoluciones":"at","compras-devoluciones":"at","stock-historico":"at",
  productos:"name","proveedores-condiciones":"amount","rentabilidad-segmentos":"sales"
 }[section];
 const requested=order==="default"?defaultKey:order;
 if(!Object.hasOwn(mapping,requested)||!["asc","desc"].includes(direction))
  throw Error("Orden incorrecto");
 const sort=`ORDER BY ${mapping[requested]} ${direction.toUpperCase()} NULLS LAST`;
 if(section==="stock-historico")return `
 -- Entradas y salidas documentadas: NO son snapshots históricos de inventario.
 -- Devueltas y anuladas conservan el signo del modelo documental.
 WITH sales AS (
  SELECT f.id AS fid,f.nombre AS pharmacy,v.fecha::date AS day,
   sum(v.unidades)::float8 AS units,
   count(DISTINCT (v.sistema_origen,v.documento_id))::int AS tickets
  FROM ${q}.fm_ventas_analitica v ${join}
  WHERE ${range} GROUP BY f.id,f.nombre,v.fecha::date
 ), purchases AS (
  SELECT f.id AS fid,f.nombre AS pharmacy,v.fecha::date AS day,
   sum(v.unidades)::float8 AS units,
   count(DISTINCT (v.sistema_origen,v.documento_id))::int AS receipts
  FROM ${q}.fm_recepciones_analitica v ${join}
  WHERE ${range}
    AND ${includedPurchaseSupplier({tenant:"$4",code:"v.proveedor_id"})}
  GROUP BY f.id,f.nombre,v.fecha::date
 ), movements AS (
  SELECT coalesce(s.fid,p.fid)::text AS "pharmacyId",
   coalesce(s.pharmacy,p.pharmacy) AS "pharmacyName",
   coalesce(s.day,p.day) AS "at",
   coalesce(s.units,0)::float8 AS "soldUnits",
   coalesce(p.units,0)::float8 AS "receivedUnits",
   (coalesce(p.units,0)-coalesce(s.units,0))::float8 AS "documentedNetUnits",
   coalesce(s.tickets,0)::int AS tickets,
   coalesce(p.receipts,0)::int AS receipts
  FROM sales s FULL OUTER JOIN purchases p ON p.fid=s.fid AND p.day=s.day
 )
 SELECT *,count(*) OVER()::int AS total,
  sum("soldUnits") OVER()::float8 AS "summaryValue",
  sum("receivedUnits") OVER()::float8 AS "summaryUnits",
  sum("documentedNetUnits") OVER()::float8 AS "summaryOther"
 FROM movements WHERE ($5::text='' OR "pharmacyName" ILIKE '%'||$5||'%'
   OR to_char("at",'YYYY-MM-DD') LIKE '%'||$5||'%')
 ${sort},"pharmacyId" ${slice}`;
 if(section==="ventas-tickets")return `
 WITH documents AS (
  SELECT f.id::text AS "pharmacyId",max(f.nombre) AS "pharmacyName",
   v.sistema_origen AS "sourceSystem",v.documento_id AS "documentId",
   coalesce(max(nullif(v.numero_ticket,'')),v.documento_id) AS "ticket",
   max(v.fecha) AS "at",max(v.vendedor_id) AS "sellerId",
   count(*)::int AS "lines",sum(v.unidades)::float8 AS "units",
   sum(v.importe)::float8 AS "amount"
  FROM ${q}.fm_ventas_analitica v ${join}
  WHERE ${range}
    AND ($5::text='' OR f.nombre ILIKE '%'||$5||'%' OR
     v.documento_id ILIKE '%'||$5||'%' OR v.numero_ticket ILIKE '%'||$5||'%')
  GROUP BY f.id,v.sistema_origen,v.documento_id
 )
 SELECT *,count(*) OVER()::int AS total,
  sum("amount") OVER()::float8 AS "summaryValue",
  sum("units") OVER()::float8 AS "summaryUnits",
  NULL::float8 AS "summaryOther"
 FROM documents ${sort},"pharmacyId","documentId" DESC ${slice}`;
 if(section==="compras-recepciones")return `
 WITH documents AS (
  SELECT f.id::text AS "pharmacyId",max(f.nombre) AS "pharmacyName",
   v.sistema_origen AS "sourceSystem",v.documento_id AS "documentId",
   coalesce(max(nullif(v.numero_albaran,'')),v.documento_id) AS reference,
   max(v.numero_pedido) AS "orderNumber",
   max(v.proveedor_id) AS "supplierCode",
   max(nullif(pm.nombre,'')) AS "supplierName",
   max(v.fecha) AS "at",count(*)::int AS "lines",
   sum(v.unidades)::float8 AS "units",sum(v.importe)::float8 AS "amount"
  FROM ${q}.fm_recepciones_analitica v ${join}
  LEFT JOIN farmetrica.proveedores_maestro pm ON pm.cliente_slug=$4
   AND upper(btrim(pm.codigo_origen))=upper(btrim(v.proveedor_id))
  WHERE ${range}
   AND ${includedPurchaseSupplier({tenant:"$4",code:"v.proveedor_id"})}
   AND ($5::text='' OR f.nombre ILIKE '%'||$5||'%' OR
    v.documento_id ILIKE '%'||$5||'%' OR
    coalesce(v.numero_albaran,'') ILIKE '%'||$5||'%' OR
    coalesce(v.numero_pedido,'') ILIKE '%'||$5||'%' OR
    coalesce(v.proveedor_id,'') ILIKE '%'||$5||'%' OR
    coalesce(pm.nombre,'') ILIKE '%'||$5||'%')
  GROUP BY f.id,v.sistema_origen,v.documento_id
 )
 SELECT *,count(*) OVER()::int AS total,
  sum("amount") OVER()::float8 AS "summaryValue",
  sum("units") OVER()::float8 AS "summaryUnits",
  sum("lines") OVER()::float8 AS "summaryOther"
 FROM documents ${sort},"pharmacyId","documentId" DESC ${slice}`;
 if(section==="ventas-devoluciones")return `
 WITH events AS (
  SELECT h.farmacia_codigo,h.fecha AS "at",h.sistema_origen AS "sourceSystem",
   h.documento_id AS "documentId",coalesce(h.numero_documento,h.documento_id) AS reference,
   NULL::text AS article,NULL::text AS "lineId",NULL::float8 AS units,
   NULL::float8 AS amount,'Anulación de documento'::text AS kind
  FROM ${q}.fm_ventas_cabeceras h
  WHERE (lower(btrim(h.estado)) IN ('anulado','anulada','cancelado','cancelada','void')
     OR h.eliminado_logicamente)
  UNION ALL
  SELECT v.farmacia_codigo,v.fecha,v.sistema_origen,v.documento_id,
   coalesce(v.numero_ticket,v.documento_id),v.articulo_id,v.linea_id,
   v.unidades::float8,v.importe::float8,'Devolución'::text
  FROM ${q}.fm_ventas_analitica v WHERE v.unidades<0 OR v.importe<0
  UNION ALL
  SELECT h.farmacia_codigo,h.fecha,h.sistema_origen,h.documento_id,
   coalesce(h.numero_documento,h.documento_id),l.articulo_origen_id,l.linea_id,
   NULL::float8,NULL::float8,'Línea anulada'::text
  FROM ${q}.fm_ventas_cabeceras h
  JOIN ${q}.fm_ventas_lineas l ON l.farmacia_codigo=h.farmacia_codigo
    AND l.sistema_origen=h.sistema_origen AND l.documento_id=h.documento_id
  WHERE h.lineas_completas AND NOT h.eliminado_logicamente
   AND lower(btrim(h.estado)) NOT IN ('anulado','anulada','cancelado','cancelada','void')
   AND NOT l.eliminada_logicamente AND l.anulada IS TRUE
 )
 SELECT f.id::text AS "pharmacyId",f.nombre AS "pharmacyName",
  v.*,count(*) OVER()::int AS total,
  sum(CASE WHEN v.kind='Devolución' THEN abs(coalesce(v.amount,0)) ELSE 0 END)
     OVER()::float8 AS "summaryValue",
  sum(CASE WHEN v.kind='Devolución' THEN abs(coalesce(v.units,0)) ELSE 0 END)
     OVER()::float8 AS "summaryUnits",
  count(*) FILTER(WHERE v.kind<>'Devolución') OVER()::float8 AS "summaryOther"
 FROM events v ${join} WHERE v."at" >= $1::date AND v."at" < $2::date+interval '1 day'
  AND ($5::text='' OR f.nombre ILIKE '%'||$5||'%' OR
    v.reference ILIKE '%'||$5||'%' OR v."documentId" ILIKE '%'||$5||'%' OR
    coalesce(v.article,'') ILIKE '%'||$5||'%')
 ${sort},v."documentId" DESC,v."lineId" DESC NULLS LAST ${slice}`;
 if(section==="compras-devoluciones")return `
 SELECT f.id::text AS "pharmacyId",f.nombre AS "pharmacyName",
  v.fecha AS "at",v.sistema_origen AS "sourceSystem",v.documento_id AS "documentId",
  coalesce(v.numero_albaran,v.documento_id) AS reference,v.linea_id AS "lineId",
  v.articulo_id AS article,v.proveedor_id AS supplier,v.proveedor_id AS "supplierCode",
  v.unidades::float8 AS units,v.importe::float8 AS amount,
  count(*) OVER()::int AS total,
  sum(abs(coalesce(v.importe,0))) OVER()::float8 AS "summaryValue",
  sum(abs(coalesce(v.unidades,0))) OVER()::float8 AS "summaryUnits",
  NULL::float8 AS "summaryOther"
 FROM ${q}.fm_recepciones_analitica v ${join}
 WHERE ${range} AND (v.unidades<0 OR v.importe<0)
  AND ${includedPurchaseSupplier({tenant:"$4",code:"v.proveedor_id"})}
  AND ($5::text='' OR f.nombre ILIKE '%'||$5||'%' OR
   v.documento_id ILIKE '%'||$5||'%' OR
   coalesce(v.numero_albaran,'') ILIKE '%'||$5||'%' OR
   v.articulo_id ILIKE '%'||$5||'%' OR
   coalesce(v.proveedor_id,'') ILIKE '%'||$5||'%')
 ${sort},v.documento_id DESC,v.linea_id DESC ${slice}`;
 if(section==="productos"){
  const col=(field,cast="text")=>columns.has(field)?`a."${field}"`:`NULL::${cast}`;
  const stamp=columns.has("sincronizado_en")?"a.sincronizado_en DESC NULLS LAST":"a.origen_id";
  return `
 WITH catalog AS (
  SELECT DISTINCT ON (f.id,a.origen_id)
   f.id::text AS "pharmacyId",f.nombre AS "pharmacyName",
   a.origen_id AS "sourceId",${col("codigo_nacional")} AS cn,
   a.nombre AS name,${col("familia")} AS family,${col("laboratorio")} AS laboratory,
   ${col("pvp","numeric")}::float8 AS pvp,
   ${col("pmc","numeric")}::float8 AS pmc,
   ${col("puc","numeric")}::float8 AS puc,
   ${col("stock_actual","numeric")}::float8 AS stock
  FROM ${q}.articulos a
  JOIN farmetrica.farmacias f ON f.cliente_slug=$4
   AND upper(btrim(a.farmacia_codigo))=${pharmacyDataCodeSQL("f")}
   AND f.id=ANY($3::int[])
  WHERE nullif(btrim(a.origen_id),'') IS NOT NULL
    AND $1::date <= $2::date
  ORDER BY f.id,a.origen_id,${stamp}
 )
 SELECT *,count(*) OVER()::int AS total,
  NULL::float8 AS "summaryValue",NULL::float8 AS "summaryUnits",
  NULL::float8 AS "summaryOther"
 FROM catalog
 WHERE ($5::text='' OR cn ILIKE '%'||$5||'%' OR name ILIKE '%'||$5||'%' OR
   "sourceId" ILIKE '%'||$5||'%' OR family ILIKE '%'||$5||'%')
 ${sort},"pharmacyId","sourceId" ${slice}`;
 }
 if(section==="proveedores-condiciones")return `
 WITH suppliers AS (
  SELECT f.id::text AS "pharmacyId",max(f.nombre) AS "pharmacyName",
   v.proveedor_id AS "supplierCode",max(nullif(pm.nombre,'')) AS "supplierName",
   count(*)::int AS lines,count(DISTINCT v.articulo_id)::int AS products,
   count(DISTINCT (v.sistema_origen,v.documento_id))::int AS receipts,
   sum(v.unidades)::float8 AS units,sum(v.importe)::float8 AS amount,
   max(v.fecha) AS "lastAt"
  FROM ${q}.fm_recepciones_analitica v ${join}
  LEFT JOIN farmetrica.proveedores_maestro pm ON pm.cliente_slug=$4
    AND upper(btrim(pm.codigo_origen))=upper(btrim(v.proveedor_id))
  WHERE ${range}
    AND ${includedPurchaseSupplier({tenant:"$4",code:"v.proveedor_id"})}
    AND ($5::text='' OR f.nombre ILIKE '%'||$5||'%' OR
       v.proveedor_id ILIKE '%'||$5||'%' OR pm.nombre ILIKE '%'||$5||'%')
  GROUP BY f.id,v.proveedor_id
 )
 SELECT *,count(*) OVER()::int AS total,
  sum(amount) OVER()::float8 AS "summaryValue",
  sum(units) OVER()::float8 AS "summaryUnits",
  sum(receipts) OVER()::float8 AS "summaryOther"
 FROM suppliers ${sort},"supplierCode" ${slice}`;
 if(section==="rentabilidad-segmentos"){
  // La familia del catálogo es REAL. Nunca atribuir costes a líneas sin PMC.
  const family=columns.has("familia")?"a.familia":"NULL::text";
  const pmc=columns.has("pmc")?"a.pmc":"NULL::numeric";
  const timestamp=columns.has("sincronizado_en")?"ORDER BY a.sincronizado_en DESC NULLS LAST":"";
  return `
 WITH grouped AS MATERIALIZED (
  SELECT f.id,upper(btrim(v.farmacia_codigo)) AS code,v.articulo_id,
   sum(v.unidades)::numeric AS units,sum(v.importe)::numeric AS sales
  FROM ${q}.fm_ventas_analitica v ${join}
  WHERE ${range} AND nullif(btrim(v.articulo_id),'') IS NOT NULL
  GROUP BY f.id,upper(btrim(v.farmacia_codigo)),v.articulo_id
 ), catalog AS MATERIALIZED (
  SELECT g.*,nullif(btrim(coalesce(art.family,'')),'') AS family,art.pmc
  FROM grouped g LEFT JOIN LATERAL (
    SELECT ${family} AS family,${pmc} AS pmc
    FROM ${q}.articulos a
    WHERE upper(btrim(a.farmacia_codigo))=g.code AND a.origen_id=g.articulo_id
    ${timestamp} LIMIT 1
  ) art ON true
 ), sections AS (
  SELECT coalesce(family,'Sin clasificar') AS family,
   sum(sales)::float8 AS sales,sum(units)::float8 AS units,
   sum(sales) FILTER(WHERE pmc>0)::float8 AS "coveredSales",
   sum(sales-units*pmc) FILTER(WHERE pmc>0)::float8 AS margin,
   count(*) FILTER(WHERE pmc>0)::int AS "costedReferences",
   count(*)::int AS references
  FROM catalog GROUP BY coalesce(family,'Sin clasificar')
 )
 SELECT *,count(*) OVER()::int AS total,
  sum(sales) OVER()::float8 AS "summaryValue",
  sum(units) OVER()::float8 AS "summaryUnits",
  sum(margin) OVER()::float8 AS "summaryOther"
 FROM sections WHERE ($5::text='' OR family ILIKE '%'||$5||'%')
 ${sort},family ${slice}`;
 }
 throw Error("Pantalla no soportada");
}
export function setupDocumentScreens(app,pool,{requireTenant}){
 // Catálogo consultable por cualquier usuario del módulo Compras.
 // Nunca expone proveedores ni nombres de otras farmacias o clientes.
 app.get("/api/analytics/catalogos/proveedores",...requireTenant(),async(req,res,next)=>{
  try{
   if(req.user?.role!=="superadministrador"&&
      req.context.modules?.compras!==true&&req.context.modules?.proveedores!==true)
    return res.status(403).json({error:"Módulo no habilitado"});
   const farmacia=String(req.query.farmacia||"");
   if(!/^[1-9]\\d{0,8}$/.test(farmacia))
    return res.status(400).json({error:"Farmacia inválida"});
   const items=await listCommercialSuppliers(pool,req.context,Number(farmacia));
   res.json({items});
  }catch(e){if(e.status)return res.status(e.status).json({error:e.message});next(e);}
 });
 app.get("/api/analytics/pantallas/:section",...requireTenant(),async(req,res,next)=>{
  try{
   const section=String(req.params.section||""),module=DOCUMENT_SECTIONS[section];
   if(!module)return res.status(404).json({error:"Pantalla no disponible"});
   if(req.user?.role!=="superadministrador"&&req.context.modules?.[module]!==true)
    return res.status(403).json({error:"Módulo no habilitado"});
   const f=parse(req);
   if(!f.ids.length)return res.json({section,available:true,rows:[],total:0,
     page:f.page,pageSize:f.size,summary:{value:null,units:null,other:null}});
   let columns=new Set();
   if(["productos","rentabilidad-segmentos"].includes(section)){
    const {rows}=await pool.query(
     "SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='articulos'",[f.schema]);
    columns=new Set(rows.map(r=>r.column_name));
    if(!["farmacia_codigo","origen_id","nombre"].every(n=>columns.has(n)))
     return res.json({section,available:false,rows:[],total:0,
      message:"El catálogo de artículos todavía no está sincronizado para esta farmacia."});
   }
   const sql=buildDocumentScreenSQL(section,f.schema,columns,
    String(req.query.orden||"default"),String(req.query.direccion||"desc"));
   const {rows}=await pool.query({text:sql,values:[f.from,f.to,f.ids,f.slug,f.search,f.size,(f.page-1)*f.size]});
   const named=["ventas-tickets","compras-recepciones","compras-devoluciones",
    "proveedores-condiciones"].includes(section)?
    await nameCommercialRows(pool,req.context,rows):rows;
   res.json(result(named,f,section,
    section==="rentabilidad-segmentos"?"El margen es estimado y solo utiliza referencias con PMC del catálogo.":""));
  }catch(e){
   if(e.status)return res.status(e.status).json({error:e.message});
   if(e.message==="Orden incorrecto")return res.status(400).json({error:e.message});
   next(e);
  }
 });
 // Desglose de una recepción completa, sujeto a cliente, módulo y farmacia.
 // El resultado usa líneas netas, no suma otra vez el total de su cabecera.
 app.get("/api/analytics/pantallas/compras-recepciones/lineas",...requireTenant(),async(req,res,next)=>{
  try{
   if(req.user?.role!=="superadministrador"&&req.context.modules?.compras!==true)
    return res.status(403).json({error:"Módulo no habilitado"});
   const f=parse(req);
   const farmacia=Number(req.query.farmacia);
   const sistema=String(req.query.sistema||"").trim();
   const documento=String(req.query.documento||"").trim();
   if(!Number.isSafeInteger(farmacia)||!f.ids.includes(farmacia))
    return res.status(403).json({error:"Farmacia no autorizada"});
   if(!sistema||!documento||sistema.length>100||documento.length>160)
    return res.status(400).json({error:"Documento incorrecto"});
   const q='"'+f.schema+'"';
   const {rows}=await pool.query({
    text:`SELECT v.linea_id AS "lineId",v.articulo_id AS "articleId",
     v.fecha AS "at",v.unidades::float8 AS units,
     v.precio_unitario_bruto::float8 AS "unitPrice",
     v.coste_unitario::float8 AS "netUnitCost",
     v.importe::float8 AS amount,
     v.proveedor_id AS "supplierCode"
     FROM ${q}.fm_recepciones_analitica v
     JOIN farmetrica.farmacias f ON f.cliente_slug=$4
      AND upper(btrim(v.farmacia_codigo))=${pharmacyDataCodeSQL("f")}
     WHERE v.fecha >= $1::date AND v.fecha < $2::date+interval '1 day'
      AND f.id=$3 AND v.sistema_origen=$5 AND v.documento_id=$6
      AND ${includedPurchaseSupplier({tenant:"$4",code:"v.proveedor_id"})}
     ORDER BY v.linea_id LIMIT 501`,
    values:[f.from,f.to,farmacia,f.slug,sistema,documento]
   });
   const lines=await nameCommercialRows(pool,req.context,
    rows.slice(0,500).map(line=>({...line,pharmacyId:String(farmacia)})));
   res.json({farmacia,sistema,documento,lines,truncated:rows.length>500});
  }catch(e){if(e.status)return res.status(e.status).json({error:e.message});next(e);}
 });
 // Desglose del ticket en líneas originales, sin aplanar cantidades ni sumar
 // importe de cabecera. Se exige permiso del módulo, farmacia, ERP y documento.
 app.get("/api/analytics/pantallas/ventas-tickets/lineas",...requireTenant(),async(req,res,next)=>{
  try{
   if(req.user?.role!=="superadministrador"&&req.context.modules?.ventas!==true)
    return res.status(403).json({error:"Módulo no habilitado"});
   const f=parse(req);
   const farmacia=Number(req.query.farmacia);
   const sistema=String(req.query.sistema||"").trim();
   const documento=String(req.query.documento||"").trim();
   if(!Number.isSafeInteger(farmacia)||!f.ids.includes(farmacia))
    return res.status(403).json({error:"Farmacia no autorizada"});
   if(!sistema||!documento||sistema.length>100||documento.length>160)
    return res.status(400).json({error:"Documento incorrecto"});
   const q='"'+f.schema+'"';
   const {rows}=await pool.query({
    text:`SELECT v.linea_id AS "lineId",v.articulo_id AS "articleId",
      v.fecha AS "at",v.unidades::float8 AS units,
      v.precio_unitario::float8 AS "unitPrice",
      v.descuento_linea::float8 AS discount,
      l.descuento_linea_tipo AS "discountType",
      v.importe::float8 AS amount,
      v.coste_historico::float8 AS "historicalCost"
     FROM ${q}.fm_ventas_analitica v
     JOIN farmetrica.farmacias f ON f.cliente_slug=$4
       AND upper(btrim(v.farmacia_codigo))=${pharmacyDataCodeSQL("f")}
     LEFT JOIN ${q}.fm_ventas_lineas l ON l.farmacia_codigo=v.farmacia_codigo
       AND l.sistema_origen=v.sistema_origen AND l.documento_id=v.documento_id
       AND l.linea_id=v.linea_id
     WHERE v.fecha>=$1::date AND v.fecha<$2::date+interval '1 day'
       AND f.id=$3 AND v.sistema_origen=$5 AND v.documento_id=$6
     ORDER BY v.linea_id LIMIT 500`,
    values:[f.from,f.to,farmacia,f.slug,sistema,documento]
   });
   res.json({farmacia,sistema,documento,lines:rows,
    truncated:rows.length===500});
  }catch(e){if(e.status)return res.status(e.status).json({error:e.message});next(e);}
 });

}
