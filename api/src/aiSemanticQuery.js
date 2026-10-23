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
 ventas:{importe:"Importe neto de ventas (€)",unidades:"Unidades vendidas",
  precio_medio:"Precio medio realizado por unidad vendida (ventas / unidades; no tarifa vigente)",movimientos:"Líneas de venta",
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
 {titulo:"Top productos por unidades, ventas y precio medio realizado",consulta:{fuente:"ventas",agrupar:["farmacia","producto"],metricas:["unidades","importe","precio_medio"],periodo:"este_mes",ordenar:{campo:"unidades",direccion:"desc"},limite:20}},
 {titulo:"Vendedores que más venden hoy",consulta:{fuente:"ventas",agrupar:["farmacia","vendedor"],
  metricas:["importe","unidades"],periodo:"hoy",ordenar:{campo:"importe",direccion:"desc"},limite:30}},
 {titulo:"Vendedores con más ventas este año",consulta:{fuente:"ventas",agrupar:["farmacia","vendedor"],
  metricas:["importe","unidades"],periodo:"este_anio",ordenar:{campo:"importe",direccion:"desc"},limite:50}},
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
  metricas:["importe","unidades"],periodo:"historico",ordenar:{campo:"anio",direccion:"asc"}}},
 {titulo:"Compras por proveedor y farmacia este mes",consulta:{fuente:"compras",agrupar:["farmacia","proveedor"],
  metricas:["importe"],periodo:"este_mes",ordenar:{campo:"importe",direccion:"desc"}}},
 {titulo:"Importe recibido de un proveedor concreto",consulta:{fuente:"compras",agrupar:["farmacia","proveedor"],
  metricas:["importe"],periodo:"ultimos_90_dias",proveedor:"Nombre o código del proveedor"}},
 {titulo:"Ventas de productos solares el año pasado (clasificación aproximada)",consulta:{fuente:"ventas",
  agrupar:["farmacia"],metricas:["importe"],periodo:"ultimos_365_dias",producto:"categoria:solares"}},
 {titulo:"Margen estimado en porcentaje por farmacia",consulta:{fuente:"ventas",agrupar:["farmacia"],
  metricas:["margen_estimado_pct","lineas_con_coste"],periodo:"este_mes"}}
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
  descripcion:"La IA elige fuente, dimensiones, métricas y filtros del catálogo. Farmétrica genera SQL parametrizado y limitado al cliente/farmacias permitidas. No se ejecuta SQL libre.",
  mapa_relaciones:{
   ventas:"fm_ventas_analitica: fecha, farmacia_codigo, articulo_id, vendedor_id, unidades, importe. Farmacia + vendedor_id identifica al vendedor; artículo + farmacia resuelve catálogo/coste PMC actual.",
   compras:"fm_recepciones_analitica: fecha, farmacia_codigo, articulo_id, proveedor_id, unidades, importe. proveedor_nombre puede ser NULL permanente; agrupar por farmacia y proveedor_id, resolver el nombre en (farmacia_codigo, origen_id) del maestro proveedores o en proveedores_maestro del mismo tenant.",
   stock:"articulos: farmacia_codigo, origen_id, nombre, familia, codigo_nacional, stock_actual, pmc, puc; stock actual no admite fecha histórica."
  },
  interpretacion:{
   fechas:"Períodos relativos según Europe/Madrid o fechas ISO desde/hasta. Para los últimos N días use fechas explícitas calculadas por la IA.",
   solares:"producto=categoria:solares busca solar/fotoprotector/SPF en nombre de artículo; resultado aproximado, no clasificación garantizada por familia.",
   gasto:"Compras equivale a importes documentados de recepciones; no es gasto contable fiscal.",
   margen:"margen_estimado y margen_estimado_pct usan coste PMC ACTUAL por línea con coste disponible, NO ventas menos compras del período ni beneficio neto.",
   precio:"precio_medio es importe vendido dividido por unidades netas; no es PVP vigente ni precio de catálogo; sin unidades no se calcula.",
   privacidad:"No se devuelve un esquema privado ni se permite SQL arbitrario, DDL, DML, funciones o columnas no catalogadas.",
   avanzado:"Si resolver_pregunta devuelve aclaracion o no_disponible, una IA avanzada puede usar consultar_semantica con un plan de consulta admitido. Nunca redactar SQL libre."
  },
  fuentes:Object.fromEntries(Object.keys(DIMENSIONS).map(k=>[k,{
   descripcion:k==="ventas"?"Ventas por farmacia, producto, vendedor y período":
    k==="compras"?"Recepciones por farmacia, proveedor, artículo y período":
    "Stock actual, referencias y ritmo de venta de 90 días",
   origen:k==="ventas"?"fm_ventas_analitica":k==="compras"?"fm_recepciones_analitica":"articulos",
   dimensiones:Object.keys(DIMENSIONS[k]),metricas:METRICS[k],advertencias:WARNINGS[k]
  }])),
  parametros:{
   fuente:"ventas | compras | stock",
   agrupar:"Array de 0 a 3 dimensiones permitidas por fuente. Para vendedor o proveedor en varias farmacias se añade farmacia automáticamente para no mezclar IDs ERP.",
   metricas:"Array de 1 a 5 métricas permitidas para la fuente.",
   periodo:"hoy | ayer | esta_semana | semana_pasada | este_mes | mes_pasado | este_anio | historico | ultimos_7_dias | ultimos_30_dias | ultimos_90_dias | ultimos_365_dias",
   desde:"AAAA-MM-DD; con hasta; puede ser cualquier año disponible.",
   hasta:"AAAA-MM-DD; con desde; puede ser cualquier año disponible.",
   farmacias:"IDs autorizados; omitir para todas las farmacias del enlace.",
   producto:"Parte del nombre, CN o ID de artículo. categoria:solares activa sinónimos comerciales aproximados (máximo 80 caracteres).",
   vendedor:"Identificador del vendedor (máximo 80 caracteres).",
   proveedor:"Nombre o código del proveedor, siempre aislado por farmacia y cliente (máximo 80 caracteres).",
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
 let dims=input.agrupar??["farmacia"];
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
 // La IA puede pedir solo "vendedor"; incorporar farmacia mantiene la identidad
 // local de los códigos sin rechazar la consulta ni mezclar vendedores distintos.
 if(source==="ventas"&&dims.includes("vendedor")&&!dims.includes("farmacia")&&ids.length>1){
  if(dims.length===3)throw err("Para comparar vendedores de varias farmacias, incluye farmacia entre las tres dimensiones");
  dims=["farmacia",...dims];
 }
 // Los códigos ERP de proveedor pueden repetirse entre farmacias:
 // en un desglose por proveedor, separar además por farmacia.
 if(source==="compras"&&dims.includes("proveedor")&&!dims.includes("farmacia")&&ids.length>1){
  if(dims.length===3)throw err("Incluye farmacia para proveedores de varias farmacias");
  dims=["farmacia",...dims];
 }
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
  precio_medio:"(sum(b.importe)/nullif(sum(b.unidades),0))::float8",
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
function baseSql(source,schema,params,where,needsArticle,{solar=false}={}){
 // Los solares cubren períodos largos: evitar un LATERAL por cada línea
 // histórica; el maestro artículos tiene una clave por farmacia + origen.
 const articleJoin=source==="stock"||!needsArticle?"":solar?`
 JOIN ${schema}.articulos a
  ON upper(btrim(a.farmacia_codigo))=upper(btrim(t.farmacia_codigo))
  AND a.origen_id=t.articulo_id
  AND (coalesce(a.nombre,'') ILIKE $5
    OR coalesce(a.nombre,'') ILIKE '%fotoprotect%'
    OR coalesce(a.nombre,'') ILIKE '%spf %'
    OR coalesce(a.nombre,'') ILIKE '%sun protect%')`:`
 LEFT JOIN LATERAL (
  SELECT a.nombre,a.codigo_nacional,a.familia,a.pmc,a.puc
  FROM ${schema}.articulos a WHERE upper(btrim(a.farmacia_codigo))=upper(btrim(t.farmacia_codigo))
   AND a.origen_id=t.articulo_id LIMIT 1
 ) a ON true`;
 if(source!=="stock"){
  if(params[0]!==null)where.push("t.fecha >= $1::date");
  if(params[1]!==null)where.push("t.fecha < ($2::date+interval '1 day')");
  const estimated=needsArticle?
   "CASE WHEN a.pmc>0 AND t.importe IS NOT NULL AND t.unidades IS NOT NULL THEN t.importe-t.unidades*a.pmc END":
   "NULL::numeric";
  const extra=source==="ventas"?
   "nullif(btrim(t.vendedor_id::text),'') AS vendedor,NULL::text AS proveedor, "+estimated+" AS margen_estimado,":
   "NULL::text AS vendedor,coalesce(nullif(btrim(t.proveedor_id::text),''),"+
    "nullif(btrim(t.proveedor_nombre::text),'')) AS proveedor,NULL::numeric AS margen_estimado,";
  const product=needsArticle?"coalesce(nullif(a.nombre,''),t.articulo_id,'Sin referencia')":"t.articulo_id";
  const cn=needsArticle?"a.codigo_nacional":"NULL::text";
  const family=needsArticle?"a.familia":"NULL::text";
  return `SELECT f.id AS farmacia_id,f.nombre AS farmacia,${extra}
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
 // En stock no se filtra por fechas; aun así la sentencia utiliza los
 // parámetros $3, $4, $5. Dar tipo explícito a $1 y $2 evita el error
 // de PostgreSQL "could not determine data type of parameter $1".
 where.push("$1::date IS NULL","$2::date IS NULL");
 const base=`SELECT f.id AS farmacia_id,f.nombre AS farmacia,a.origen_id AS articulo_id,
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

// Agrupación de vendedores histórica: evita proyecciones ajenas a la consulta.
function compileSellerSales(q,schema,params){
 if(q.source!=="ventas"||q.dims.join(",")!=="farmacia,vendedor"||
    q.metrics.some(m=>!["importe","unidades","movimientos","precio_medio"].includes(m))||
    q.producto!==undefined||q.proveedor!==undefined||q.estadoStock!==undefined||
    q.dates.desde===null||q.dates.hasta===null)return null;
 const expressions={
  importe:"coalesce(sum(t.importe),0)::float8",
  unidades:"coalesce(sum(t.unidades),0)::float8",
  movimientos:"count(*)::int",
  precio_medio:"(sum(t.importe)/nullif(sum(t.unidades),0))::float8"
 };
 const metrics=q.metrics.map(m=>expressions[m]+' AS "'+m+'"').join(", ");
 const where=["f.id=ANY($3::int[])","t.fecha >= $1::date",
  "t.fecha < ($2::date + interval '1 day')"];
 if(q.vendedor!==undefined){
  params.push(q.vendedor.trim());
  where.push("t.vendedor_id::text=$"+params.length);
 }
 params.push(q.limit);
 const sql='SELECT f.id AS "farmaciaId", f.nombre AS "farmacia", '+
  'nullif(btrim(t.vendedor_id::text), \'\') AS "vendedor", '+metrics+
  ' FROM '+schema+'.fm_ventas_analitica t '+
  'JOIN farmetrica.farmacias f ON f.cliente_slug=$4 '+
  'AND upper(btrim(t.farmacia_codigo))='+code+
  ' WHERE '+where.join(" AND ")+
  ' GROUP BY f.id,f.nombre,nullif(btrim(t.vendedor_id::text), \'\')'+
  ' ORDER BY "'+q.order.campo+'" '+q.order.direccion.toUpperCase()+
  ' NULLS LAST LIMIT $'+params.length+'::int';
 return {sql,params,q};
}

export function compileSemanticQuery(input,context){
 const q=validateSemanticQuery(input,context);
 const schema=quoteSchema(context.client.schema);
 const params=[q.dates.desde,q.dates.hasta,q.ids,context.client.slug];
 const seller=compileSellerSales(q,schema,params);
 if(seller)return seller;
 let where=["f.id=ANY($3::int[])"];
 if(q.producto!==undefined){
  params.push("%"+q.producto.trim()+"%");
  const alias=q.source==="stock"?"a":"t";
  const productName=q.source==="stock"?"a.nombre":"a.nombre";
  const productID=q.source==="stock"?"a.origen_id":"t.articulo_id";
  if(q.producto==="categoria:solares"){
   // Clasificación aproximada por nombre; no se asegura familia farmacéutica.
   params[params.length-1]="%solar%";
   // El filtro solar se aplica en el JOIN de artículos, antes del agregado.
  }else where.push(`(coalesce(${productName},'') ILIKE $${params.length} OR coalesce(${productID},'') ILIKE $${params.length})`);
 }
 if(q.vendedor!==undefined){
  params.push(q.vendedor.trim());where.push(`t.vendedor_id::text=$${params.length}`);
 }
 if(q.proveedor!==undefined){
  params.push("%"+q.proveedor.trim()+"%");
  const key="$"+params.length;
  where.push("(t.proveedor_id::text ILIKE "+key+
   " OR coalesce(t.proveedor_nombre,'') ILIKE "+key+
   " OR EXISTS (SELECT 1 FROM farmetrica.proveedores_maestro pm"+
   " WHERE pm.cliente_slug=$4 AND upper(btrim(pm.codigo_origen))=upper(btrim(t.proveedor_id::text))"+
   " AND pm.nombre ILIKE "+key+")"+
   (context.localSupplierCatalogAvailable?
    " OR EXISTS (SELECT 1 FROM "+schema+".proveedores local_p"+
    " WHERE upper(btrim(local_p.farmacia_codigo::text))=upper(btrim(t.farmacia_codigo::text))"+
    " AND upper(btrim(local_p.origen_id::text))=upper(btrim(t.proveedor_id::text))"+
    " AND local_p.nombre ILIKE "+key+")":"")+")");
 }
 // Rows are always scoped by client and authorized IDs before aggregation.
 const needsArticle=q.source==="stock"||q.producto!==undefined||
  q.dims.some(d=>["producto","codigo_nacional","familia"].includes(d))||
  q.metrics.some(k=>["margen_estimado","margen_estimado_pct","lineas_con_coste"].includes(k));
 let base=baseSql(q.source,schema,params,where,needsArticle,{
  solar:q.source==="ventas"&&q.producto==="categoria:solares"
 });
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
  // El nombre de farmacia no es una clave única: exponer su ID evita
  // fusionar vendedores de dos farmacias que casualmente se llamen igual.
  ...((q.dims.includes("farmacia")||q.dims.includes("proveedor"))?['b.farmacia_id AS "farmaciaId"']:[]),
  ...q.dims.map(d=>`${DIM_SQL[d]} AS "${d}"`),
  ...q.metrics.map(m=>`${measures[q.source][m]} AS "${m}"`)
 ];
 const group=q.dims.length?" GROUP BY "+[
  ...((q.dims.includes("farmacia")||q.dims.includes("proveedor"))?["b.farmacia_id"]:[]),
  ...q.dims.map(d=>DIM_SQL[d])
 ].join(","):"";
 const order=` ORDER BY "${q.order.campo}" ${q.order.direccion.toUpperCase()} NULLS LAST`;
 params.push(q.limit);
 const result={
  sql:`SELECT ${projections.join(",")} FROM (${base}) b${group}${order} LIMIT $${params.length}::int`,
  params,q
 };
 return result;
}
export async function runSemanticQuery(pool,context,input){
 let effectiveContext=context;
 if(input?.fuente==="compras"&&input.proveedor!==undefined){
  // Activar el maestro local solo si existe y usa clave compuesta por farmacia.
  // Las tablas legacy proveedores(id,nombre) no permiten cruces multi-farmacia.
  validateSemanticQuery(input,context);
  const {rows:[availability]}=await pool.query(
   "SELECT count(DISTINCT column_name)::int AS n FROM information_schema.columns"+
   " WHERE table_schema=$1 AND table_name='proveedores'"+
   " AND column_name=ANY($2::text[])",
   [context.client.schema,["farmacia_codigo","origen_id","nombre"]]);
  effectiveContext={...context,localSupplierCatalogAvailable:Number(availability?.n)===3};
 }
 const {sql,params,q}=compileSemanticQuery(input,effectiveContext);
 if(!q.ids.length)return {fuente:q.source,periodo:q.dates,filas:[],advertencias:WARNINGS[q.source]};
 const result=await readOnly(pool,async db=>{
  await db.query(q.source==="ventas"&&q.dims.includes("vendedor")&&
   (q.dates.desde===null||q.dates.hasta===null||
    Date.parse(q.dates.hasta)-Date.parse(q.dates.desde)>90*86400000)?
   "SET LOCAL statement_timeout='24000ms'":"SET LOCAL statement_timeout='12000ms'");
  return db.query(sql,params);
 });
 let rows=result.rows;
 if(q.source==="compras"&&q.dims.includes("proveedor")&&rows.length){
  const entries=rows.map(row=>({
   pharmacyId:q.ids.length===1?q.ids[0]:Number(row.farmaciaId),
   supplierCode:row.proveedor
  })).filter(x=>Number.isSafeInteger(x.pharmacyId)&&q.ids.includes(x.pharmacyId)&&x.supplierCode);
  if(entries.length){
   const names=await loadCommercialNames(pool,context,entries);
   rows=rows.map(row=>{
    const pharmacyId=q.ids.length===1?q.ids[0]:Number(row.farmaciaId);
    const known=Number.isSafeInteger(pharmacyId)&&q.ids.includes(pharmacyId)&&row.proveedor&&
     names.supplierKnown(pharmacyId,row.proveedor);
    return {...row,proveedorCodigo:row.proveedor,proveedor:known?names.supplier(pharmacyId,row.proveedor):
     (row.proveedor&&/[^0-9]/.test(row.proveedor)&&!/^\d+[a-z0-9_-]*$/i.test(row.proveedor)?
      row.proveedor:null)};
   });
  }
 }
 if(q.source==="ventas"&&q.dims.includes("vendedor")&&rows.length){
  const entries=rows.map(row=>({
   pharmacyId:q.ids.length===1?q.ids[0]:Number(row.farmaciaId),
   sellerId:row.vendedor
  })).filter(x=>Number.isSafeInteger(x.pharmacyId)&&q.ids.includes(x.pharmacyId)&&x.sellerId);
  if(entries.length){
   const names=await loadCommercialNames(pool,context,entries);
   rows=rows.map(row=>{
    const pharmacyId=q.ids.length===1?q.ids[0]:Number(row.farmaciaId);
    return {...row,vendedorNombre:Number.isSafeInteger(pharmacyId)&&q.ids.includes(pharmacyId)&&row.vendedor?
     names.seller(pharmacyId,row.vendedor):row.vendedor};
   });
  }
 }
 return {modo:"consulta_semantica",origen:"PostgreSQL",ficticio:false,
  fuente:q.source,periodo:q.dates,dimensiones:q.dims,metricas:q.metrics,
  farmacias_autorizadas:q.ids.length,filas:rows,
  limite:q.limit,advertencias:[
   ...WARNINGS[q.source],
   ...(q.source==="ventas"&&q.producto==="categoria:solares"?
    ["La categoría «solares» se aproxima por la denominación comercial; no es una clasificación validada de familias ni garantiza cobertura completa."]:[]),
   ...(q.source==="compras"&&q.dims.includes("proveedor")&&rows.some(row=>row.proveedor===null)?
    ["Hay proveedores sin nombre en el maestro; no se atribuyen sus importes a otra empresa."]:[])
  ]};
}
