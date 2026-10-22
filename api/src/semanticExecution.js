// Ejecutor y resultado CANÓNICO para cualquiera de los MCP y el asistente.
// La IA nunca calcula diferencias ni decide que ausencia de filas equivale a cero.
import {interpretSemanticQuestion} from "./semanticInterpreter.js";
import {runSemanticQuery} from "./aiSemanticQuery.js";

const round=(v,places=2)=>{
 const factor=10**places;
 return Math.round((v+Math.sign(v)*Number.EPSILON)*factor)/factor;
};
const num=value=>{
 if(value===null||value===undefined||value==="")return null;
 const n=Number(value);
 return Number.isFinite(n)?n:null;
};
const formatted=new Intl.NumberFormat("es-ES",{minimumFractionDigits:2,maximumFractionDigits:2});
const formattedUnits=new Intl.NumberFormat("es-ES",{maximumFractionDigits:2});
const amount=(n,metric)=>metric==="importe"?formatted.format(n)+" €":formattedUnits.format(n)+" unidades";
function indexRows(rows,dimensions,metric){
 const m=new Map();
 for(const row of rows){
  if(!row||typeof row!=="object")throw new Error("Resultado de consulta incompleto");
  let key="total";
  if(dimensions.includes("farmacia")){
   const id=Number(row.farmaciaId);
   if(!Number.isSafeInteger(id)||id<1)
    throw new Error("No puede compararse por farmacia sin identificador verificable");
   key=String(id);
  }
  if(m.has(key))throw new Error("La consulta devolvió grupos duplicados");
  m.set(key,{key,farmaciaId:dimensions.includes("farmacia")?Number(row.farmaciaId):undefined,
   farmacia:dimensions.includes("farmacia")?String(row.farmacia??"Farmacia "+row.farmaciaId):undefined,
   valor:num(row[metric])});
 }
 return m;
}
export function combineCanonicalPeriods(actualRows,previousRows,{dimensions,metric}){
 if(!["importe","unidades","movimientos"].includes(metric)||
  !Array.isArray(dimensions)||dimensions.some(d=>d!=="farmacia"))
  throw new TypeError("Las comparaciones solo admiten totales y agrupación por farmacia con métricas aditivas");
 if(actualRows.length>=100||previousRows.length>=100)
  throw new TypeError("Los datos superan el límite seguro de 100 grupos. Filtra por farmacia.");
 const current=indexRows(actualRows,dimensions,metric);
 const previous=indexRows(previousRows,dimensions,metric);
 const rows=[];
 for(const key of new Set([...current.keys(),...previous.keys()])){
  const a=current.get(key),b=previous.get(key);
  const n=a?.valor??null,p=b?.valor??null;
  const complete=n!==null&&p!==null;
  const diff=complete?round(n-p):null;
  const change=complete&&p!==0?round((n-p)/Math.abs(p)*100):null;
  rows.push({
   ...(dimensions.includes("farmacia")?{farmaciaId:a?.farmaciaId??b?.farmaciaId,
    farmacia:a?.farmacia??b?.farmacia}:{}),
   actual:n,anterior:p,diferencia:diff,variacion_pct:change,
   estado:complete?"completo":n===null&&p===null?"sin_datos":
    n===null?"sin_datos_actuales":"sin_datos_anteriores"
  });
 }
 rows.sort((a,b)=>dimensions.includes("farmacia")?
  (a.farmaciaId-b.farmaciaId):0);
 return rows;
}
export function writeCanonicalComparison(result){
 const {filas,comparacion,metrica,fuente}=result;
 const period=range=>range.desde===range.hasta?range.desde:range.desde+" a "+range.hasta;
 const label=metrica==="importe"?"Importe":metrica==="unidades"?"Unidades":"Movimientos";
 const prefix=label+" de "+fuente+": "+period(comparacion.actual)+" frente a "+period(comparacion.anterior)+".";
 if(!filas.length)return prefix+" No hay filas verificadas para ninguno de los dos períodos; no se puede calcular una variación.";
 const grouped=filas[0].farmaciaId!==undefined;
 const entries=filas.map(row=>{
  const name=grouped?row.farmacia+": ":"";
  if(row.estado!=="completo")return name+"faltan datos verificables de uno de los períodos; variación no calculable.";
  const unit=metrica==="importe"?"importe":"unidades";
  const fmt=v=>metrica==="importe"?amount(v,"importe"):metrica==="movimientos"?
   formattedUnits.format(v)+" movimientos":amount(v,unit);
  return name+fmt(row.actual)+" frente a "+fmt(row.anterior)+
   "; diferencia "+(row.diferencia>0?"+":"")+fmt(row.diferencia)+
   "; variación "+(row.variacion_pct===null?"no calculable (base cero)":
    (row.variacion_pct>0?"+":"")+formatted.format(row.variacion_pct)+" %")+".";
 });
 return prefix+"\n"+entries.join("\n");
}
export async function executeCanonicalQuestion(pool,context,pregunta,opts={}){
 const interpreted=interpretSemanticQuestion(pregunta,context,opts);
 if(interpreted.estado==="comparacion"){
  // Secuencial: no duplicar carga SQL pesada en el VPS de producción.
  const first=await runSemanticQuery(pool,context,interpreted.consultas[0]);
  const second=await runSemanticQuery(pool,context,interpreted.consultas[1]);
  const dimensions=first.dimensiones??interpreted.consultas[0].agrupar;
  const metric=first.metricas?.[0]??interpreted.consultas[0].metricas[0];
  if(first.fuente!==second.fuente||
    JSON.stringify(dimensions)!==JSON.stringify(second.dimensiones)||
    JSON.stringify(first.metricas)!==JSON.stringify(second.metricas))
   throw new Error("Los períodos tienen métricas incompatibles");
  const filas=combineCanonicalPeriods(first.filas,second.filas,{dimensions,metric});
  const result={...interpreted,modo:"comparacion_semantica",origen:"PostgreSQL",
   ficticio:false,soloLectura:true,fuente:first.fuente,metrica:metric,dimensiones:dimensions,
   filas,periodos:{actual:first.periodo,anterior:second.periodo},
   advertencias:[...new Set([...(first.advertencias||[]),...(second.advertencias||[]),
    "Ambas ventanas incluyen el mismo número de días, salvo límites naturales del calendario.",
    "Una fila ausente no equivale a cero; no se estima la variación sin datos en ambos períodos."])]};
  return {...result,respuesta:writeCanonicalComparison(result)};
 }
 if(interpreted.estado==="ok"){
  const result=await runSemanticQuery(pool,context,interpreted.consulta);
  return {...interpreted,...result};
 }
 return {...interpreted,origen:"Farmétrica",soloLectura:true};
}
