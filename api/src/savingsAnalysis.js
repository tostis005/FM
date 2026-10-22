// Informe económico verificable. Acceso exclusivo mediante sesión y permisos del tenant.
// SQL cerrado, sólo SELECT, sin secretos, ni datos de pacientes, ni escritura ERP.
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
import {includedPurchaseSupplier} from "./supplierReporting.js";

const ISO=/^20\d{2}-\d{2}-\d{2}$/;
const SCHEMA=/^[a-z][a-z0-9_]{1,62}$/;
const currency=n=>n==null?null:Math.round(Number(n)*100)/100;
const number=n=>Number(n||0);
const validDate=s=>ISO.test(s)&&!Number.isNaN(Date.parse(s+"T00:00:00Z"))&&
 new Date(s+"T00:00:00Z").toISOString().slice(0,10)===s;
export function economicScope(req){
 const from=String(req.query.desde||""),to=String(req.query.hasta||"");
 if(!validDate(from)||!validDate(to)||from>to||
  Date.parse(to)-Date.parse(from)>366*86400000)throw Object.assign(new Error("Período inválido: máximo 367 días"),{status:400});
 const ctx=req.context;
 if(!SCHEMA.test(ctx?.client?.schema||""))throw Object.assign(new Error("Esquema no válido"),{status:400});
 if(!["administrador","superadministrador"].includes(ctx.role))
  throw Object.assign(new Error("El análisis económico requiere administración"),{status:403});
 const can=key=>ctx.role==="superadministrador"||ctx.modules?.[key]===true;
 if(!["ventas","compras","stock"].every(can))
  throw Object.assign(new Error("Se requieren permisos de Ventas, Compras y Stock"),{status:403});
 const allowed=(ctx.allowedPharmacyIds||[]).map(Number);
 const raw=String(req.query.farmacias||"");
 if(raw.length>250)throw Object.assign(new Error("Filtro de farmacias inválido"),{status:400});
 const ids=raw?raw.split(",").map(Number):allowed;
 if(ids.some(n=>!Number.isSafeInteger(n)||!allowed.includes(n))||ids.length>50)
  throw Object.assign(new Error("Farmacia no autorizada"),{status:403});
 return {from,to,ids:[...new Set(ids)],slug:ctx.client.slug,schema:'"'+ctx.client.schema+'"'};
}
export async function readOnly(pool,callback){
 const db=await pool.connect();
 try{
  await db.query("BEGIN TRANSACTION READ ONLY");
  await db.query("SET LOCAL statement_timeout='25000ms'");
  await db.query("SET LOCAL lock_timeout='1500ms'");
  return await callback(db);
 }finally{
  try{await db.query("ROLLBACK");}catch{}
  db.release();
 }
}
const join=alias=>" JOIN farmetrica.farmacias f ON f.cliente_slug=$4 AND upper(btrim("+alias+".farmacia_codigo))="+pharmacyDataCodeSQL("f");
const window=alias=>alias+".fecha >= $1::date AND "+alias+".fecha < ($2::date + interval '1 day') AND f.id=ANY($3::int[])";
const params=s=>[s.from,s.to,s.ids,s.slug];

// Detecta coherencia de códigos locales: dos farmacias pueden llamar de forma
// distinta al mismo código ERP. Sin nombre local contrastado NO se afirma que
// un proveedor sea un laboratorio ni se le atribuye ahorro.
const supplierCode=col=>{
 const x="upper(btrim("+col+"::text))";
 return "(CASE WHEN "+x+" ~ '^0*[0-9]+$' THEN coalesce(nullif(ltrim("+x+",'0'),''),'0') ELSE "+x+" END)";
};
const supplierJoins=(schema)=>`
 LEFT JOIN ${schema}.proveedores sp ON upper(btrim(sp.farmacia_codigo))=upper(btrim(r.farmacia_codigo))
   AND upper(btrim(sp.origen_id))=upper(btrim(r.proveedor_id::text))
 LEFT JOIN LATERAL (
   SELECT x.codigo_origen,x.cooperativa,x.ignorar_informes
   FROM farmetrica.proveedores_maestro x
   WHERE x.cliente_slug=$4 AND ${supplierCode("x.codigo_origen")}=${supplierCode("r.proveedor_id")}
     AND nullif(btrim(sp.nombre),'') IS NOT NULL
     AND upper(btrim(x.nombre))=upper(btrim(sp.nombre))
   ORDER BY (upper(btrim(x.codigo_origen))=upper(btrim(r.proveedor_id::text))) DESC,
     x.codigo_origen LIMIT 1
 ) pm ON true`;
const channel=`CASE WHEN pm.ignorar_informes IS TRUE THEN 'excluido'
 WHEN pm.cooperativa IS TRUE THEN 'cooperativa'
 WHEN pm.codigo_origen IS NOT NULL AND pm.cooperativa IS FALSE THEN 'no_cooperativa'
 ELSE 'sin_verificar' END`;

// Consolida sólo importes con cobertura completa. NULL nunca equivale a 0 euros.
export function combineEconomicRows(sales,purchases,stock){
 const saleTotals={sales:0,units:0,lines:0,withAmount:0};
 for(const r of sales){saleTotals.sales+=number(r.amount);saleTotals.units+=number(r.units);
  saleTotals.lines+=number(r.lines);saleTotals.withAmount+=number(r.withAmount);}
 const buyTotals={purchases:0,units:0,lines:0,withAmount:0,channels:{}};
 for(const r of purchases){
  buyTotals.purchases+=number(r.amount);buyTotals.units+=number(r.units);
  buyTotals.lines+=number(r.lines);buyTotals.withAmount+=number(r.withAmount);
  const c=buyTotals.channels[r.channel]||{amount:0,units:0,lines:0,withAmount:0};
  c.amount+=number(r.amount);c.units+=number(r.units);c.lines+=number(r.lines);
  c.withAmount+=number(r.withAmount);buyTotals.channels[r.channel]=c;
 }
 const stockTotals={amount:0,lines:0,priced:0,updated:null};
 for(const r of stock){stockTotals.amount+=number(r.amount);stockTotals.lines+=number(r.lines);
  stockTotals.priced+=number(r.priced);
  if(!stockTotals.updated||String(r.updated)>stockTotals.updated)stockTotals.updated=r.updated;}
 return {
  sales:{amount:saleTotals.lines===saleTotals.withAmount?currency(saleTotals.sales):null,
   units:saleTotals.units,lines:saleTotals.lines,pricedLines:saleTotals.withAmount},
  purchases:{amount:buyTotals.lines===buyTotals.withAmount?currency(buyTotals.purchases):null,
   units:buyTotals.units,lines:buyTotals.lines,pricedLines:buyTotals.withAmount,
   channels:Object.fromEntries(Object.entries(buyTotals.channels).map(([k,v])=>
    [k,{...v,amount:v.withAmount===v.lines?currency(v.amount):null}]))},
  stock:{amount:stockTotals.lines===stockTotals.priced?currency(stockTotals.amount):null,
   valuedSubtotal:currency(stockTotals.amount),references:stockTotals.lines,
   pricedReferences:stockTotals.priced,lastSync:stockTotals.updated}
 };
}
export async function economicOverview(db,scope){
 const p=params(scope);
 const [sale,buy,stock]=await Promise.all([
  db.query(`SELECT f.id::text AS "pharmacyId",f.nombre AS pharmacy,
   count(*)::int AS lines,count(v.importe)::int AS "withAmount",
   coalesce(sum(v.importe),0)::float8 AS amount,coalesce(sum(v.unidades),0)::float8 AS units
   FROM ${scope.schema}.fm_ventas_analitica v ${join("v")} WHERE ${window("v")}
   GROUP BY f.id,f.nombre ORDER BY f.id`,p),
  db.query(`SELECT f.id::text AS "pharmacyId",f.nombre AS pharmacy,
   ${channel} AS channel,count(*)::int AS lines,count(r.importe)::int AS "withAmount",
   coalesce(sum(r.importe),0)::float8 AS amount,coalesce(sum(r.unidades),0)::float8 AS units
   FROM ${scope.schema}.fm_recepciones_analitica r ${join("r")}
   ${supplierJoins(scope.schema)}
   WHERE ${window("r")} AND ${includedPurchaseSupplier({tenant:"$4",code:"r.proveedor_id",name:"r.proveedor_nombre"})}
   GROUP BY f.id,f.nombre,channel ORDER BY f.id,channel`,p),
  db.query(`SELECT f.id::text AS "pharmacyId",f.nombre AS pharmacy,
   count(*) FILTER (WHERE a.stock_actual>0)::int AS lines,
   count(*) FILTER (WHERE a.stock_actual>0 AND (CASE WHEN a.pmc>0 THEN a.pmc WHEN a.puc>0 THEN a.puc END)>0)::int AS priced,
   coalesce(sum(greatest(a.stock_actual,0)*
    (CASE WHEN a.pmc>0 THEN a.pmc WHEN a.puc>0 THEN a.puc END)) FILTER(WHERE a.stock_actual>0),0)::float8 AS amount,
   max(a.sincronizado_en) AS updated
   FROM ${scope.schema}.articulos a
   JOIN farmetrica.farmacias f ON f.cliente_slug=$2
    AND upper(btrim(a.farmacia_codigo))=${pharmacyDataCodeSQL("f")}
   WHERE f.id=ANY($1::int[]) GROUP BY f.id,f.nombre ORDER BY f.id`,
   [scope.ids,scope.slug])
 ]);
 // Proveedores ignorados: excluir del gasto de compra comercial.
 const bought=buy.rows.filter(r=>r.channel!=="excluido");
 return {period:{from:scope.from,to:scope.to},pharmacies:scope.ids.length,
  totals:combineEconomicRows(sale.rows,bought,stock.rows),
  salesByPharmacy:sale.rows,purchasesByPharmacy:buy.rows,stockByPharmacy:stock.rows,
  warnings:[
   "Las compras no clasificadas no se consideran compras directas a laboratorio.",
   "Una farmacia puede reutilizar un código ERP para otro proveedor; se exige coincidencia de nombre local.",
   "Stock es una fotografía; sin valoración completa sólo se muestra subtotal, nunca un total ficticio.",
   "Los importes de compras son netos de recepciones documentales, excluyendo proveedores ignorados."
  ]};
}
export async function economicPrices(db,scope,limit=25){
 const safeLimit=Number(limit);
 if(!Number.isInteger(safeLimit)||safeLimit<1||safeLimit>50)
  throw Object.assign(new Error("Máximo 50 artículos"),{status:400});
 const ignored=includedPurchaseSupplier({tenant:"$4",code:"r.proveedor_id"});
 const p=params(scope);
 const sql=`WITH grouped AS MATERIALIZED (
  SELECT f.id::text AS fid,btrim(r.articulo_id) AS article,
   ${channel} AS channel,
   sum(r.unidades)::numeric AS units,count(*)::int AS lines,
   sum(r.unidades*r.coste_unitario)/nullif(sum(r.unidades),0) AS puc
  FROM ${scope.schema}.fm_recepciones_analitica r ${join("r")}
  ${supplierJoins(scope.schema)}
  WHERE ${window("r")} AND ${ignored}
   AND r.unidades>0 AND r.coste_unitario>0
   AND nullif(btrim(r.articulo_id),'') IS NOT NULL
  GROUP BY f.id,btrim(r.articulo_id),channel
 ), pairs AS (
  SELECT fid,article,
   max(puc) FILTER(WHERE channel='cooperativa') AS coop_puc,
   max(puc) FILTER(WHERE channel='no_cooperativa') AS other_puc,
   max(units) FILTER(WHERE channel='cooperativa') AS coop_units,
   max(lines) FILTER(WHERE channel='cooperativa') AS coop_lines,
   max(lines) FILTER(WHERE channel='no_cooperativa') AS other_lines
  FROM grouped WHERE channel IN ('cooperativa','no_cooperativa')
  GROUP BY fid,article HAVING count(DISTINCT channel)=2
 ), comparable AS (
  SELECT fid,article,coop_puc,other_puc,coop_units,coop_lines,other_lines,
   greatest(0,coop_puc-other_puc)*coop_units AS diff_eur
  FROM pairs WHERE coop_puc>other_puc
 ), totals AS (
  SELECT count(*)::int AS references,
   count(*) FILTER(WHERE coop_lines>=2 AND other_lines>=2)::int AS verified,
   coalesce(sum(diff_eur) FILTER(WHERE coop_lines>=2 AND other_lines>=2),0)::float8 AS observed,
   coalesce(sum(diff_eur),0)::float8 AS indicative FROM comparable
 ), paged AS (
  SELECT * FROM comparable ORDER BY diff_eur DESC,fid,article LIMIT $5::int
 ) SELECT to_jsonb(totals) AS totals,
  coalesce((SELECT jsonb_agg(to_jsonb(paged)) FROM paged),'[]'::jsonb) AS rows
 FROM totals`;
 const {rows}=await db.query(sql,[...p,safeLimit]);
 const result=rows[0]||{totals:{},rows:[]};
 return {period:{from:scope.from,to:scope.to},...result,
  formula:"(PUC cooperativa ponderado - PUC no cooperativa ponderado) × unidades compradas a cooperativa; sólo si positivo",
  criteria:"Misma farmacia y mismo artículo ERP. Diferencial contrastado: mínimo 2 líneas de cada canal. Sin rappels, portes ni garantía de disponibilidad.",
  limitation:"No se proyecta ahorro para referencias sin ambos precios observados; no se equipara automáticamente 'no cooperativa' con laboratorio."};
}
export async function economicStock(db,scope){
 const p=params(scope);
 const sql=`WITH sold AS MATERIALIZED (
  SELECT f.id AS fid,btrim(v.articulo_id) AS article,
   sum(v.unidades) AS units_period,
   sum(v.unidades) FILTER(WHERE v.fecha>=($2::date-interval '89 days')) AS units_90
  FROM ${scope.schema}.fm_ventas_analitica v ${join("v")}
  WHERE ${window("v")} AND nullif(btrim(v.articulo_id),'') IS NOT NULL
  GROUP BY f.id,btrim(v.articulo_id)
 ), articles AS (
  SELECT f.id AS fid, a.origen_id,a.stock_actual,a.sincronizado_en,
   (CASE WHEN a.pmc>0 THEN a.pmc WHEN a.puc>0 THEN a.puc END) AS cost,
   s.units_period,s.units_90,p.cobertura_saludable,
   greatest(coalesce(s.units_period,0)/greatest(1,$2::date-$1::date+1),
    coalesce(s.units_90,0)/90.0) AS daily
  FROM ${scope.schema}.articulos a
  JOIN farmetrica.farmacias f ON f.cliente_slug=$4
   AND upper(btrim(a.farmacia_codigo))=${pharmacyDataCodeSQL("f")}
  LEFT JOIN sold s ON s.fid=f.id AND s.article=btrim(a.origen_id)
  LEFT JOIN farmetrica.op_politicas_reposicion p
    ON p.cliente_slug=$4 AND p.farmacia_id=f.id
  WHERE f.id=ANY($3::int[]) AND a.stock_actual>0
 ) SELECT fid::text AS "pharmacyId",
  count(*)::int AS "references",
  count(*) FILTER(WHERE cost>0)::int AS "pricedReferences",
  count(*) FILTER(WHERE coalesce(units_period,0)<=0)::int AS "withoutSales",
  coalesce(sum(stock_actual*cost) FILTER(WHERE cost>0 AND coalesce(units_period,0)<=0),0)::float8 AS "withoutSalesValue",
  count(*) FILTER(WHERE cobertura_saludable IS NOT NULL)::int AS "withPolicy",
  coalesce(sum(greatest(0,stock_actual-ceil(daily*cobertura_saludable))*cost)
    FILTER(WHERE cost>0 AND cobertura_saludable IS NOT NULL AND daily>0),0)::float8 AS "excessCapital",
  max(sincronizado_en) AS "lastSync"
 FROM articles GROUP BY fid ORDER BY fid`;
 const {rows}=await db.query(sql,p);
 return {period:{from:scope.from,to:scope.to},rows,
  note:"Capital de existencias según coste real (PMC o PUC), no ahorro recurrente. Exceso sólo con días objetivo configurados; sin ventas en el período se informa aparte. Fotografías antiguas y costes ausentes requieren validación."};
}
export function setupSavingsAnalysis(app,pool,{requireTenant}){
 const access=requireTenant();
 const lastByUser=new Map();
 let active=0;
 const endpoint=(path,fn)=>app.get("/api/analytics/ahorro/"+path,...access,async(req,res,next)=>{
  let admitted=false;
  try{
   const scope=economicScope(req);
   const key=scope.slug+":"+String(req.user?.email||"").toLowerCase()+":"+path;
   const now=Date.now();
   if(active>=3||now-(lastByUser.get(key)||0)<8000)
    return res.status(429).json({error:"Análisis en curso. Evita consultas repetidas."});
   active+=1;admitted=true;lastByUser.set(key,now);
   if(lastByUser.size>2000)lastByUser.clear();
   if(!scope.ids.length)return res.json({period:{from:scope.from,to:scope.to},empty:true});
   const result=await readOnly(pool,db=>fn(db,scope,req));
   res.json(result);
  }catch(error){
   if(error.status)return res.status(error.status).json({error:error.message});
   if(["57014","55P03"].includes(error.code))
    return res.status(503).json({error:"Análisis demasiado pesado para este momento; reduce el período o las farmacias."});
   next(error);
  }finally{if(admitted)active-=1;}
 });
 endpoint("resumen",economicOverview);
 endpoint("precios",(db,scope,req)=>economicPrices(db,scope,Number(req.query.limite||25)));
 endpoint("stock",economicStock);
}
