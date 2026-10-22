// Consulta semántica segura: la IA combina dimensiones y métricas publicadas.
// No recibe SQL del usuario; todos los fragmentos SQL son constantes auditadas.
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
import {quoteSchema,periodFromQuestion,authorizedIds} from "./assistantAnalytics.js";
import {readOnly} from "./savingsAnalysis.js";
import {loadCommercialNames} from "./commercialNames.js";

const DIMENSIONS={
 ventas:{farmacia:"farmacia",vendedor:"vendedor",producto:"producto",
  codigo_nacional:"codigo_nacional",familia:"familia",dia:"dia",mes:"mes",anio:"anio"},
 compras:{farmacia:"farmacia",proveedor:"proveedor",producto:"producto",
  codigo_nacional:"codigo_nacional",familia:"familia",dia:"dia",mes:"mes",anio:"anio"},
 stock:{farmacia:"farmacia",producto:"producto",codigo_nacional:"codigo_nacional",familia:"familia"}
};
const METRICS={
 ventas:{importe:"Importe neto de ventas (€)",unidades:"Unidades vendidas",movimientos:"Líneas de venta",
  margen_estimado:"Importe neto menos unidades por coste PMC actual; NO beneficio contable",
  margen_estimado_pct:"Porcentaje estimado sobre ventas con PMC disponible: suma(margen estimado)/suma(ventas cubiertas)*100; no es margen neto contable",
  lineas_con_coste:"Líneas con coste PMC contrastable"},
 compras:{importe:"Importe documentado de recepciones (€)",unidades:"Unidades recibidas",
  movimientos:"Líneas de recepción",coste_unitario_medio:"Media ponderada de coste unitario válido"},
 stock:{stock_actual:"Unidades actuales en stock",capital_estimado:"Valor estimado a PMC/PUC (€)",
  venta_90d:"Unidades vendidas en 90 días",dias_cobertura:"Días de stock a ritmo de 90 días",
  referencias:"Referencias con stock",referencias_sin_coste:"Referencias sin coste válido"}
};
const WARNINGS={
 ventas:["margen_estimado usa PMC ACTUAL; la venta histórica puede haber tenido otro coste.",
  "Los importes de ventas podrían incluir IVA o devoluciones; no se calcula margen contable fiscal."],
 compras:["Importe documentado de recepciones; no equivale necesariamente a gasto contable.",
  "Las recepciones pueden incluir devoluciones y proveedores ignorados por otros informes."],
 stock:["Existencias actuales, no fotografía histórica.",
  "Días de cobertura calculados sobre ventas netas de 90 días. Sin ventas: cobertura no calculable.",
  "Valor de stock a PMC o PUC disponible; subtotal cuando faltan costes."]
};
const examples=[
 {titulo:"Vendedores que más venden hoy",consulta:{fuente:"ventas",agrupar:["farmacia","vendedor"],
  metricas:["importe","unidades"],periodo:"hoy",ordenar:{campo:"importe",direccion:"desc"},limite:30}},
 {titulo:"Ventas por farmacia del mes pasado",consulta:{fuente:"ventas",agrupar:["farmacia"],
  metricas:["importe","movimientos"],periodo:"mes_pasado"}},
 {titulo:"Artículos con mayor margen estimado",consulta:{fuente:"ventas",agrupar:["farmacia","producto"],
  metricas:["importe","margen_estimado","lineas_con_coste"],periodo:"este_mes",
  ordenar:{campo:"margen_estimado",direccion:"desc"},limite:40}},
 {titulo:"Productos más vendidos en julio del año pasado",consulta:{fuente:"ventas",
  agrupar:["farmacia","producto"],metricas:["unidades","importe"],desde:"2025-07-01",
  hasta:"2025-07-31",ordenar:{campo:"unidades",direccion:"desc"},limite:40}},
 {titulo:"Productos con poco stock",consulta:{fuente:"stock",agrupar:["farmacia","producto"],
  metricas:["stock_actual","venta_90d","dias_cobertura"],estado_stock:"bajo",
  ordenar:{campo:"dias_cobertura",direccion:"asc"},limite:40}},
 {titulo:"Ventas históricas por año",consulta:{fuente:"ventas",agrupar:["anio"],
  metricas:["importe","unidades"],periodo:"historico",ordenar:{campo:"anio",direccion:"asc"}}}
];
// Esquema compartido por ambos servidores MCP; los nombres reales del catálogo
// son las únicas dimensiones y métricas que pueden incluirse en SQL.
const ALL_DIMENSIONS=[...new Set(Object.values(DIMENSIONS).flatMap(x=>Object.keys(x)))];
const ALL_METRICS=[...new Set(Object.values(METRICS).flatMap(x=>Object.keys(x)))];
export const SEMANTIC_MCP_QUERY_SCHEMA={
 type:"object",
 description:"Plan de consulta generado por la IA a partir de la pregunta libre y catalogo_semantico; no es SQL.",
 properties:{
  fuente:{type:"string",enum:["ventas","compras","stock"]},
  agrupar:{type:"array",items:{type:"string",enum:ALL_DIMENSIONS},maxItems:3,
   description:"Columnas para agrupar las métricas, según la fuente seleccionada."},
  metricas:{type:"array",items:{type:"string",enum:ALL_METRICS},minItems:1,maxItems:5,
   description:"Métricas reales de la fuente; consulta su significado en catalogo_semantico."},
  periodo:{type:"string",enum:["hoy","ayer","esta_semana","semana_pasada","este_mes",
   "mes_pasado","este_anio","historico","ultimos_7_dias","ultimos_30_dias","ultimos_90_dias",
   "ultimos_365_dias"]},
  desde:{type:"string",pattern:"^\\d{4}-\\d{2}-\\d{2}$"},
  hasta:{type:"string",pattern:"^\\d{4}-\\d{2}-\\d{2}$"},
  farmacias:{type:"array",items:{type:"integer"},maxItems:50},
  producto:{type:"string",maxLength:80},
  vendedor:{type:"string",maxLength:80},
  proveedor:{type:"string",maxLength:80},
  estado_stock:{type:"string",enum:["agotado","bajo","sin_ventas"]},
  dias_max:{type:"integer",minimum:1,maximum:180},
  ordenar:{type:"object",properties:{campo:{type:"string",enum:[...ALL_DIMENSIONS,...ALL_METRICS]},
   direccion:{type:"string",enum:["asc","desc"]}},required:["campo","direccion"],additionalProperties:false},
  limite:{type:"integer",minimum:1,maximum:100}
 },
 required:["fuente","metricas"],
 additionalProperties:false
};
export function semanticCatalogForContext(ctx){
 const catalog=semanticCatalog();
 const mods=ctx?.modules||{};
 const can=key=>ctx?.role==="superadministrador"||mods[key]===true||
   (key==="ventas"&&mods.dashboard===true);
 catalog.fuentes=Object.fromEntries(Object.entries(catalog.fuentes)
  .filter(([k])=>can(k)).map(([k,v])=>[k,v]));
 catalog.ejemplos=catalog.ejemplos.filter(x=>Object.hasOwn(catalog.fuentes,x.consulta.fuente));
 return catalog;
}
export function semanticCatalog(){
 return {
  version:1,modo:"consulta_estructurada",soloLectura:true,
  descripcion:"La IA elige fuente, dimensiones, métricas y filtros; el servidor genera SQL parametrizado y aislado por cliente. No se ejecuta SQL libre.",
  fuentes:Object.fromEntries(Object.keys(DIMENSIONS).map(k=>[k,{
   descripcion:k==="ventas"?"Ventas por farmacia, producto, vendedor y período":
    k==="compras"?"Recepciones por farmacia, proveedor, artículo y período":
    "Stock actual, referencias y ritmo de venta de 90 días",
   origen:k==="ventas"?"fm_ventas_analitica":k==="compras"?"fm_recepciones_analitica":"articulos",
   dimensiones:Object.keys(DIMENSIONS[k]),metricas:METRICS[k],advertencias:WARNINGS[k]
  }])),
  parametros:{
   fuente:"ventas | compras | stock",
   agrupar:"Array de 0 a 3 dimensiones permitidas para la fuente.",
   metricas:"Array de 1 a 5 métricas permitidas para la fuente.",
   periodo:"hoy | ayer | esta_semana | semana_pasada | este_mes | mes_pasado | este_anio | historico | ultimos_7_dias | ultimos_30_dias | ultimos_90_dias | ultimos_365_dias",
   desde:"AAAA-MM-DD; con hasta; puede ser cualquier año disponible.",
   hasta:"AAAA-MM-DD; con desde; puede ser cualquier año disponible.",
   farmacias:"IDs autorizados; omitir para todas las farmacias del enlace.",
   producto:"Cadena de texto con parte del nombre, CN o identificador ERP (máximo 80 caracteres).",
   vendedor:"Identificador del vendedor (máximo 80 caracteres).",
   proveedor:"Texto de proveedor (máximo 80 caracteres).",
   estado_stock:"agotado | bajo | sin_ventas; solo fuente stock.",
   dias_max:"Umbral entre 1 y 180 días usado con estado_stock=bajo (por defecto 15).",
   ordenar:"{campo: dimensión o métrica seleccionada, direccion: asc | desc}.",
   limite:"Entero de 1 a 100 (por defecto 30)."
  },
  ejemplos:examples
 };
}
const err=msg=>Object.assign(new TypeError(msg),{status:400});
const keys=(obj,allowed)=>Object.keys(obj).every(k=>allowed.includes(k));
const validDate=x=>typeof x==="string"&&/^20\d{2}-\d{2}-\d{2}$/.test(x)&&
 !Number.isNaN(Date.parse(x+"T00:00:00Z"))&&new Date(x+"T00:00:00Z").toISOString().slice(0,10)===x;
const plus=(date,delta)=>{const x=new Date(date+"T12:00:00Z");x.setUTCDate(x.getUTCDate()+delta);return x.toISOString().slice(0,10);};
function resolveDates(spec){
 if(spec.fuente==="stock")return {desde:null,hasta:null};
 if((spec.desde===undefined)!==(spec.hasta===undefined))throw err("Indica desde y hasta");
 if(spec.desde!==undefined){
  if(spec.periodo!==undefined)throw err("Elige periodo o fechas explícitas");
  if(!validDate(spec.desde)||!validDate(spec.hasta)||spec.desde>spec.hasta)
   throw err("Fechas inválidas");
  return {desde:spec.desde,hasta:spec.hasta};
 }
 const today=periodFromQuestion("hoy").from;
 const monday=plus(today,-((new Date(today+"T12:00:00Z").getUTCDay()+6)%7));
 const period=spec.periodo||"ultimos_30_dias";
 switch(period){
  case "historico":return {desde:null,hasta:null};
  case "hoy":return {desde:today,hasta:today};
  case "ayer":return {desde:plus(today,-1),hasta:plus(today,-1)};
  case "esta_semana":return {desde:monday,hasta:today};
  case "semana_pasada":return {desde:plus(monday,-7),hasta:plus(monday,-1)};
  case "este_mes":{const d=periodFromQuestion("este mes");return {desde:d.from,hasta:d.to};}
  case "mes_pasado":{const d=periodFromQuestion("mes pasado");return {desde:d.from,hasta:d.to};}
  case "este_anio":{const d=periodFromQuestion("este año");return {desde:d.from,hasta:d.to};}
  default:{
   const dayCount={ultimos_7_dias:7,ultimos_30_dias:30,
    ultimos_90_dias:90,ultimos_365_dias:365}[period];
   if(!dayCount)throw err("Período desconocido");
   return {desde:plus(today,1-dayCount),hasta:today};
  }
 }
}
export function validateSemanticQuery(input,ctx){
 if(!input||typeof input!=="object"||Array.isArray(input)||
  !keys(input,["fuente","agrupar","metricas","periodo","desde","hasta","farmacias",
   "producto","vendedor","proveedor","estado_stock","dias_max","ordenar","limite"]))
  throw err("Consulta o atributos no autorizados");
 const source=input.fuente;
 if(!Object.hasOwn(DIMENSIONS,source))throw err("Fuente desconocida");
 const modules=ctx?.modules||{};
 const allowed=ctx?.role==="superadministrador"||modules[source]===true||
  (source==="ventas"&&modules.dashboard===true);
 if(!allowed)throw err("No tienes acceso al módulo de "+source);
 const dims=input.agrupar??["farmacia"];
 const metrics=input.metricas??(source==="stock"?["stock_actual","venta_90d"]:["importe"]);
 if(!Array.isArray(dims)||dims.length>3||dims.some(d=>typeof d!=="string"||!Object.hasOwn(DIMENSIONS[source],d))||
  new Set(dims).size!==dims.length)throw err("Dimensiones no permitidas");
 if(!Array.isArray(metrics)||metrics.length===0||metrics.length>5||
  metrics.some(m=>typeof m!=="string"||!Object.hasOwn(METRICS[source],m))||
  new Set(metrics).size!==metrics.length)throw err("Métricas no permitidas");
 const allowedFields=[...dims,...metrics];
 const limit=input.limite??30;
 if(!Number.isInteger(limit)||limit<1||limit>100)throw err("Límite no permitido");
 const order=input.ordenar??{campo:metrics[0],direccion:"desc"};
 if(!order||typeof order!=="object"||Array.isArray(order)||
  !keys(order,["campo","direccion"])||!allowedFields.includes(order.campo)||
  !["asc","desc"].includes(order.direccion))throw err("Ordenación no permitida");
 for(const field of ["producto","vendedor","proveedor"])
  if(input[field]!==undefined&&(typeof input[field]!=="string"||input[field].length>80||!input[field].trim()))
   throw err("Filtro de texto inválido");
 if((input.vendedor!==undefined&&source!=="ventas")||
  (input.proveedor!==undefined&&source!=="compras")||
  (input.estado_stock!==undefined&&source!=="stock"))
  throw err("Filtro incompatible con la fuente");
 if(input.estado_stock!==undefined&&!["agotado","bajo","sin_ventas"].includes(input.estado_stock))
  throw err("Estado de stock inválido");
 const diasMax=input.dias_max??15;
 if(!Number.isInteger(diasMax)||diasMax<1||diasMax>180)throw err("Umbral inválido");
 let ids;
 try{ids=authorizedIds(ctx,input.farmacias??[])}
 catch{throw err("Farmacias no autorizadas");}
 if(source==="ventas"&&dims.includes("vendedor")&&!dims.includes("farmacia")&&ids.length>1)
  throw err("Al agrupar vendedores de varias farmacias incluye la dimensión farmacia: los códigos de vendedor no son globales.");
 const dates=resolveDates(input);
 if(source==="stock"&&(input.desde!==undefined||input.hasta!==undefined||input.periodo!==undefined))
  throw err("El stock es actual; su ritmo de venta se calcula sobre los últimos 90 días");
 return {source,dims,metrics,limit,order,ids,dates,producto:input.producto,
  vendedor:input.vendedor,proveedor:input.proveedor,
  estadoStock:input.estado_stock,diasMax};
}

const code=pharmacyDataCodeSQL("f");
const days={dia:"b.dia",mes:"b.mes",anio:"b.anio"};
const DIM_SQL={
 farmacia:"b.farmacia",vendedor:"b.vendedor",proveedor:"b.proveedor",
 producto:"b.producto",codigo_nacional:"b.codigo_nacional",familia:"b.familia",
 ...days
};
const measures={
 ventas:{
  importe:"coalesce(sum(b.importe),0)::float8",
  unidades:"coalesce(sum(b.unidades),0)::float8",
  movimientos:"count(*)::int",
  margen_estimado:"sum(b.margen_estimado)::float8",
  margen_estimado_pct:"(100.0*sum(b.margen_estimado)/nullif(sum(b.importe) FILTER(WHERE b.margen_estimado IS NOT NULL),0))::float8",
  lineas_con_coste:"count(b.margen_estimado)::int"
 },
 compras:{
  importe:"coalesce(sum(b.importe),0)::float8",
  unidades:"coalesce(sum(b.unidades),0)::float8",
  movimientos:"count(*)::int",
  coste_unitario_medio:"(sum(b.unidades*b.coste_unitario) FILTER(WHERE b.coste_unitario>0 AND b.unidades>0)/nullif(sum(b.unidades) FILTER(WHERE b.coste_unitario>0 AND b.unidades>0),0))::float8"
 },
 stock:{
  stock_actual:"coalesce(sum(b.stock_actual),0)::float8",
  capital_estimado:"sum(b.capital_estimado)::float8",
  venta_90d:"coalesce(sum(b.venta_90d),0)::float8",
  dias_cobertura:"(sum(b.stock_actual)/nullif(sum(b.venta_90d)/90.0,0))::float8",
  referencias:"count(*)::int",
  referencias_sin_coste:"count(*) FILTER(WHERE b.coste IS NULL)::int"
 }
};
function baseSql(source,schema,params,where,needsArticle){
 const articleJoin=source==="stock"||!needsArticle?"":`
 LEFT JOIN LATERAL (
  SELECT a.nombre,a.codigo_nacional,a.familia,a.pmc,a.puc
  FROM ${schema}.articulos a WHERE upper(btrim(a.farmacia_codigo))=upper(btrim(t.farmacia_codigo))
   AND a.origen_id=t.articulo_id LIMIT 1
 ) a ON true`;
 if(source!=="stock"){
  where.push("($1::date IS NULL OR t.fecha >= $1::date)");
  where.push("($2::date IS NULL OR t.fecha < ($2::date+interval '1 day'))");
  const estimated=needsArticle?
   "CASE WHEN a.pmc>0 AND t.importe IS NOT NULL AND t.unidades IS NOT NULL THEN t.importe-t.unidades*a.pmc END":
   "NULL::numeric";
  const extra=source==="ventas"?
   "nullif(btrim(t.vendedor_id::text),'') AS vendedor,NULL::text AS proveedor, "+estimated+" AS margen_estimado,":
   "NULL::text AS vendedor,t.proveedor_nombre AS proveedor,NULL::numeric AS margen_estimado,";
  const product=needsArticle?"coalesce(nullif(a.nombre,''),t.articulo_id,'Sin referencia')":"t.articulo_id";
  const cn=needsArticle?"a.codigo_nacional":"NULL::text";
  const family=needsArticle?"a.familia":"NULL::text";
  return `SELECT f.nombre AS farmacia,${extra}
   ${product} AS producto,
   ${cn} AS codigo_nacional,${family} AS familia,t.fecha::date AS dia,
   to_char(t.fecha,'YYYY-MM') AS mes,extract(year from t.fecha)::int AS anio,
   t.importe,t.unidades,${source==="compras"?"t.coste_unitario":"NULL::numeric"} AS coste_unitario
   FROM ${schema}.${source==="ventas"?"fm_ventas_analitica":"fm_recepciones_analitica"} t
   JOIN farmetrica.farmacias f ON f.cliente_slug=$4
    AND upper(btrim(t.farmacia_codigo))=${code}
   ${articleJoin} WHERE ${where.join(" AND ")}`;
 }
 // El stock es una fotografía actual, con tendencia basada en 90 días.
 const sold=`SELECT upper(btrim(v.farmacia_codigo)) AS farmacia_codigo,btrim(v.articulo_id) AS articulo_id,
  sum(v.unidades)::numeric AS unidades FROM ${schema}.fm_ventas_analitica v
  JOIN farmetrica.farmacias f ON f.cliente_slug=$4
   AND upper(btrim(v.farmacia_codigo))=${code}
  WHERE f.id=ANY($3::int[]) AND v.fecha>=current_date-interval '89 days'
  GROUP BY upper(btrim(v.farmacia_codigo)),btrim(v.articulo_id)`;
 const base=`SELECT f.nombre AS farmacia,a.origen_id AS articulo_id,
   coalesce(nullif(a.nombre,''),a.origen_id) AS producto,a.codigo_nacional,a.familia,
   a.stock_actual::numeric AS stock_actual,
   CASE WHEN a.pmc>0 THEN a.pmc WHEN a.puc>0 THEN a.puc END AS coste,
   a.stock_actual*(CASE WHEN a.pmc>0 THEN a.pmc WHEN a.puc>0 THEN a.puc END) AS capital_estimado,
   coalesce(s.unidades,0) AS venta_90d
   FROM ${schema}.articulos a
   JOIN farmetrica.farmacias f ON f.cliente_slug=$4
    AND upper(btrim(a.farmacia_codigo))=${code}
   LEFT JOIN sold s ON s.farmacia_codigo=upper(btrim(a.farmacia_codigo))
    AND s.articulo_id=btrim(a.origen_id)
   WHERE ${where.join(" AND ")}`;
 return `WITH sold AS (${sold}), inventory AS (${base}) SELECT * FROM inventory`;
}
export function compileSemanticQuery(input,context){
 const q=validateSemanticQuery(input,context);
 const schema=quoteSchema(context.client.schema);
 const params=[q.dates.desde,q.dates.hasta,q.ids,context.client.slug];
 let where=["f.id=ANY($3::int[])"];
 if(q.producto!==undefined){
  params.push("%"+q.producto.trim()+"%");
  const alias=q.source==="stock"?"a":"t";
  const productName=q.source==="stock"?"a.nombre":"a.nombre";
  const productID=q.source==="stock"?"a.origen_id":"t.articulo_id";
  where.push(`(coalesce(${productName},'') ILIKE $${params.length} OR coalesce(${productID},'') ILIKE $${params.length})`);
 }
 if(q.vendedor!==undefined){
  params.push(q.vendedor.trim());where.push(`t.vendedor_id::text=$${params.length}`);
 }
 if(q.proveedor!==undefined){
  params.push("%"+q.proveedor.trim()+"%");where.push(`t.proveedor_nombre ILIKE $${params.length}`);
 }
 // Rows are always scoped by client and authorized IDs before aggregation.
 const needsArticle=q.source==="stock"||q.producto!==undefined||
  q.dims.some(d=>["producto","codigo_nacional","familia"].includes(d))||
  q.metrics.some(k=>["margen_estimado","margen_estimado_pct","lineas_con_coste"].includes(k));
 let base=baseSql(q.source,schema,params,where,needsArticle);
 if(q.source==="stock"){
  let state="";
  if(q.estadoStock==="agotado")state="b.stock_actual<=0";
  if(q.estadoStock==="bajo"){
   params.push(q.diasMax);
   state=`b.stock_actual>0 AND b.venta_90d>0 AND b.stock_actual/nullif(b.venta_90d/90.0,0)<=$${params.length}`;
  }
  if(q.estadoStock==="sin_ventas")state="b.venta_90d<=0";
  const ix=base.lastIndexOf("SELECT * FROM inventory");
  if(ix<0)throw Error("Consulta de stock mal configurada");
  base=base.slice(0,ix)+`SELECT * FROM inventory b${state?" WHERE "+state:""}`;
 }
 const projections=[
  ...q.dims.map(d=>`${DIM_SQL[d]} AS "${d}"`),
  ...q.metrics.map(m=>`${measures[q.source][m]} AS "${m}"`)
 ];
 const group=q.dims.length?" GROUP BY "+q.dims.map(d=>DIM_SQL[d]).join(","):"";
 const order=` ORDER BY "${q.order.campo}" ${q.order.direccion.toUpperCase()} NULLS LAST`;
 params.push(q.limit);
 const result={
  sql:`SELECT ${projections.join(",")} FROM (${base}) b${group}${order} LIMIT $${params.length}::int`,
  params,q
 };
 return result;
}
export async function runSemanticQuery(pool,context,input){
 const {sql,params,q}=compileSemanticQuery(input,context);
 if(!q.ids.length)return {fuente:q.source,periodo:q.dates,filas:[],advertencias:WARNINGS[q.source]};
 const result=await readOnly(pool,async db=>{
  await db.query("SET LOCAL statement_timeout='12000ms'");
  return db.query(sql,params);
 });
 let rows=result.rows;
 if(q.source==="ventas"&&q.dims.includes("vendedor")&&rows.length){
  const active=context.pharmacies.filter(p=>q.ids.includes(Number(p.id)));
  const nameToId=new Map();
  for(const pharmacy of active){
   const name=String(pharmacy.name);
   nameToId.set(name,nameToId.has(name)?null:Number(pharmacy.id));
  }
  const entries=rows.map(row=>({
   pharmacyId:q.ids.length===1?q.ids[0]:nameToId.get(row.farmacia),
   sellerId:row.vendedor
  })).filter(x=>Number.isSafeInteger(x.pharmacyId)&&x.sellerId);
  if(entries.length){
   const names=await loadCommercialNames(pool,context,entries);
   rows=rows.map(row=>{
    const pharmacyId=q.ids.length===1?q.ids[0]:nameToId.get(row.farmacia);
    return {...row,vendedorNombre:Number.isSafeInteger(pharmacyId)&&row.vendedor?
     names.seller(pharmacyId,row.vendedor):row.vendedor};
   });
  }
 }
 return {modo:"consulta_semantica",origen:"PostgreSQL",ficticio:false,
  fuente:q.source,periodo:q.dates,dimensiones:q.dims,metricas:q.metrics,
  farmacias_autorizadas:q.ids.length,filas:rows,
  limite:q.limit,advertencias:WARNINGS[q.source]};
}
