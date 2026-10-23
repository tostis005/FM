// Presentación pública v1 de datos canónicos. NO modificar la ejecución SQL.
// Los IDs, planes y estados internos se usan para calcular, pero no salen
// por la herramienta MCP natural ni entran en el prompt de Ollama.
const DIM_LABELS={
 farmacia:"Farmacia",vendedor:"Vendedor",proveedor:"Proveedor",producto:"Producto",
 codigo_nacional:"Código nacional",familia:"Familia",dia:"Día",mes:"Mes",anio:"Año"
};
const METRIC_LABELS={
 importe:"Importe",unidades:"Unidades",movimientos:"Movimientos",
 margen_estimado:"Margen estimado",margen_estimado_pct:"Margen estimado (%)",
 lineas_con_coste:"Líneas con coste",coste_unitario_medio:"Coste unitario medio",
 stock_actual:"Stock actual",capital_estimado:"Capital estimado",
 venta_90d:"Ventas 90 días",dias_cobertura:"Días de cobertura",
 referencias:"Referencias",referencias_sin_coste:"Referencias sin coste",
 anterior:"Período anterior",actual:"Período actual",
 diferencia:"Diferencia",variacion_pct:"Variación"
};
const CURRENCY=new Set(["importe","margen_estimado","capital_estimado","coste_unitario_medio","anterior","actual","diferencia"]);
const PERCENT=new Set(["margen_estimado_pct","variacion_pct"]);
const nf=new Intl.NumberFormat("es-ES",{maximumFractionDigits:2,minimumFractionDigits:2});
const count=new Intl.NumberFormat("es-ES",{maximumFractionDigits:2});
const clean=s=>String(s??"").replace(/[\r\n\t]+/g," ").replace(/\s+/g," ").trim().slice(0,160);
const safeMarkdown=s=>clean(s).replace(/([|\\])/g,"\\$1");
function numeric(value,key,isCurrency=false){
 if(value===null||value===undefined||value==="")return "No disponible";
 const n=typeof value==="number"?value:
  typeof value==="string"&&/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)?Number(value):NaN;
 if(!Number.isFinite(n))return "No disponible";
 if(isCurrency||CURRENCY.has(key))return nf.format(n)+" €";
 if(PERCENT.has(key))return nf.format(n)+" %";
 return count.format(n);
}
function visibleDim(row,key,notes){
 if(key==="vendedor"){
  const value=clean(row.vendedorNombre);
  if(value&&value!==clean(row.vendedor)&&! /^\d+$/.test(value))return value;
  // No enviar IDs ERP de vendedores. Indicar explícitamente datos incompletos.
  notes.add("Hay vendedores sin nombre comercial identificable. Se muestran como «Vendedor no identificado».");
  return "Vendedor no identificado";
 }
 const val=row[key];
 if((val===null||val===undefined||clean(val)==="")){
  if(key==="proveedor"){
   notes.add("Los importes sin proveedor identificado no permiten un desglose real por proveedor.");
   return "Proveedor no identificado";
  }
  notes.add("Existen registros sin "+(DIM_LABELS[key]||key).toLowerCase()+" identificable.");
  return (DIM_LABELS[key]||"Dato")+" no identificado";
 }
 if(key==="producto"&&/^\d+$/.test(clean(val))){
  notes.add("Hay productos sin denominación comercial identificable.");
  return "Producto no identificado";
 }
 return clean(val);
}
function dimensionNames(data){
 const dims=data.comparacion?.dimensiones??data.dimensiones??data.interpretacion?.dimensiones??[];
 return Array.isArray(dims)?dims.filter(x=>Object.hasOwn(DIM_LABELS,x)):[];
}
function metricNames(data){
 if(data.comparacion)return ["anterior","actual","diferencia","variacion_pct"];
 const metrics=data.metricas??data.interpretacion?.metricas??[];
 return Array.isArray(metrics)?metrics.filter(x=>Object.hasOwn(METRIC_LABELS,x)):[];
}
const labels=(metric,source)=>{
 if(metric==="importe")return source==="ventas"?"Ventas":source==="compras"?"Compras":"Importe";
 if(metric==="anterior")return "Anterior";
 if(metric==="actual")return "Actual";
 return METRIC_LABELS[metric];
};
const titleFor=(data,dims)=>{
 const source=data.fuente??data.comparacion?.actual?.fuente??data.interpretacion?.fuente;
 const sourceTitle={ventas:"Ventas",compras:"Compras",stock:"Existencias"}[source]||"Resultados";
 const suffix=dims.length?" por "+dims.map(x=>DIM_LABELS[x].toLowerCase()).join(" y "):"";
 return (data.comparacion?"Comparación de ":"")+sourceTitle.toLowerCase().replace(/^./,c=>c.toUpperCase())+suffix;
};
function limitWarning(data,notes){
 const countGroups=data.total_grupos;
 const numberRows=Array.isArray(data.filas)?data.filas.length:0;
 if(typeof countGroups==="number"&&countGroups>numberRows)
  notes.add("Se muestran "+numberRows+" de "+countGroups+" grupos; no es un desglose completo.");
 // Sin total_grupos, el límite de la consulta implica truncamiento posible.
 else if(!data.comparacion&&Number.isInteger(data.limite)&&numberRows>=data.limite)
  notes.add("Se alcanzó el límite de "+data.limite+" filas; pueden faltar resultados.");
}
export function presentSemanticResult(data){
 if(data?.estado!=="ok")return {estado:data?.estado||"no_disponible",
  mensaje:clean(data?.mensaje||"No se pudo consultar Farmétrica.")};
 const dims=dimensionNames(data),metrics=metricNames(data),notes=new Set();
 const source=data.fuente??data.interpretacion?.fuente;
 const items=Array.isArray(data.filas)?data.filas:[];
 if(!metrics.length)return {estado:"no_disponible",mensaje:"La consulta no contiene métricas reconocidas para presentar."};
 const columns=[...dims.map(k=>DIM_LABELS[k]),...metrics.map(k=>labels(k,source))];
 const rows=items.map(row=>{
  const out={};
  for(const key of dims)out[DIM_LABELS[key]]=visibleDim(row,key,notes);
  for(const key of metrics){
   const metricLabel=labels(key,source);
   if(data.comparacion&&row.estado!=="completo"){
    out[metricLabel]=key==="anterior"&&row.anterior!==null?numeric(row.anterior,key,
     data.comparacion.unidad==="EUR"):
     key==="actual"&&row.actual!==null?numeric(row.actual,key,
      data.comparacion.unidad==="EUR"):"No calculable";
   }else{
    out[metricLabel]=numeric(row[key],key,
     data.comparacion?.unidad==="EUR"&&["anterior","actual","diferencia"].includes(key));
   }
  }
  return out;
 });
 if(!rows.length)notes.add("No se han encontrado registros para esta consulta; no equivale a un importe de cero.");
 limitWarning(data,notes);
 if(dims.includes("vendedor")){
  notes.add("Los nombres de vendedores se corresponden con cada farmacia; un mismo código interno puede pertenecer a personas distintas.");
 }
 for(const x of data.advertencias||[])if(typeof x==="string")notes.add(clean(x));
 const comparacion=data.comparacion?{
  anterior:data.comparacion.anterior,actual:data.comparacion.actual,
  ...(data.comparacion.dias_actual!==undefined?{
    dias_actual:data.comparacion.dias_actual,dias_anterior:data.comparacion.dias_anterior}:{})
 }:undefined;
 const result={estado:"ok",titulo:titleFor(data,dims),
  periodo:data.periodo??null,...(comparacion?{comparacion}:{}),
  columnas:columns,filas:rows,advertencias:[...notes]};
 return result;
}
export function renderSemanticMarkdown(data){
 const p=data?.columnas?data:presentSemanticResult(data);
 if(p.estado!=="ok")return p.mensaje;
 let content="### "+safeMarkdown(p.titulo);
 if(p.periodo?.desde||p.periodo?.hasta)
  content+="\n\nPeríodo: "+[p.periodo.desde,p.periodo.hasta].filter(Boolean).join(" a ");
 if(p.comparacion)
  content+="\n\nComparación: "+p.comparacion.actual.desde+" a "+p.comparacion.actual.hasta+
   " frente a "+p.comparacion.anterior.desde+" a "+p.comparacion.anterior.hasta;
 if(!p.filas.length)content+="\n\nNo hay registros disponibles para este período.";
 else{
  const cols=p.columnas;
  content+="\n\n| "+cols.map(safeMarkdown).join(" | ")+" |\n"+
   "| "+cols.map(()=>"---").join(" | ")+" |\n"+
   p.filas.map(r=>"| "+cols.map(c=>safeMarkdown(r[c])).join(" | ")+" |").join("\n");
 }
 if(p.advertencias.length)content+="\n\n"+p.advertencias.map(x=>"> "+safeMarkdown(x)).join("\n");
 return content;
}
function monetaryTokens(s){
 return [...String(s).matchAll(/(-?\d[\d., ]*)\s*(€|EUR|euros?|%)/gi)]
  .map(m=>({value:Number(m[1].replace(/\s/g,"").replace(/\./g,"").replace(",",".")),
   unit:m[2]==="%"?"%":"€"}))
  .filter(x=>Number.isFinite(x.value));
}
// Un número añadido por Ollama no puede convertirse en una cifra oficial.
// El servidor sustituye el borrador por un Markdown verificable si hay dudas.
export function safeAssistantMarkdown(draft,presentation){
 const fallback=renderSemanticMarkdown(presentation);
 if(typeof draft!=="string"||!draft.trim()||draft.length>6000)return fallback;
 if(/^\s*[{[]/.test(draft)||/farmaciaId|vendedorNombre|variacion_pct|estado\s*:\s*completo/i.test(draft))
  return fallback;
 if(presentation.filas.length&&/\b(no (hay|existen) datos|no tengo acceso|no puedo proporcionar)\b/i.test(draft))
  return fallback;
 const allowed=monetaryTokens(JSON.stringify(presentation.filas));
 const provided=monetaryTokens(draft);
 if(provided.some(x=>!allowed.some(y=>x.unit===y.unit&&Math.abs(x.value-y.value)<0.011)))
  return fallback;
 // Si la IA omite una fila, tablas oficiales al final conservan la trazabilidad.
 const named=presentation.columnas.filter(c=>["Farmacia","Vendedor","Proveedor","Producto"].includes(c));
 const incomplete=named.some(k=>presentation.filas.some(r=>r[k]&&!draft.includes(r[k])));
 if(incomplete)return fallback;
 return draft.trim();
}
