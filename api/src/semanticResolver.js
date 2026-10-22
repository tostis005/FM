// Único ejecutor para preguntas en lenguaje natural: MCP OAuth, enlaces temporales
// y chat local comparten interpretación, SQL, comparaciones y verificaciones.
import {interpretSemanticQuestion} from "./semanticInterpreter.js";
import {runSemanticQuery} from "./aiSemanticQuery.js";

const round2=value=>Math.round((value+Number.EPSILON)*100)/100;
const num=x=>x===null||x===undefined?null:
 typeof x==="number"&&Number.isFinite(x)?x:null;
const hasOwn=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const groupingKey=(row,dims)=>JSON.stringify([
 ...(dims.includes("farmacia")?[row.farmaciaId??null]:[]),
 ...dims.map(d=>hasOwn(row,d)?row[d]:null)
]);
function mergeComparedRows(previous,current,{metrica,dimensiones,direccion}){
 if(previous.length>=100||current.length>=100)
  return {estado:"no_disponible",mensaje:"Hay al menos 100 grupos en uno de los períodos. No puedo garantizar una comparación completa con el límite actual; reduce las farmacias o agrupaciones."};
 const prev=new Map(previous.map(row=>[groupingKey(row,dimensiones),row]));
 const now=new Map(current.map(row=>[groupingKey(row,dimensiones),row]));
 const keys=new Set([...prev.keys(),...now.keys()]);
 const rows=[];
 for(const key of keys){
  const before=prev.get(key),after=now.get(key);
  const a=num(before?.[metrica]),b=num(after?.[metrica]);
  if((before&&a===null)||(after&&b===null))
   return {estado:"no_disponible",mensaje:"La comparación contiene métricas sin valor verificable; no se convierten valores NULL en cero."};
  const baseline=a??0,recent=b??0;
  const values={};
  for(const dim of dimensiones)values[dim]=(after||before)?.[dim]??null;
  if(dimensiones.includes("farmacia"))values.farmaciaId=(after||before)?.farmaciaId??null;
  if(dimensiones.includes("vendedor"))values.vendedorNombre=(after||before)?.vendedorNombre??null;
  rows.push({...values,anterior:round2(baseline),actual:round2(recent),
   diferencia:round2(recent-baseline),
   variacion_pct:baseline===0?null:round2((recent-baseline)/Math.abs(baseline)*100)});
 }
 rows.sort((a,b)=>(direccion==="asc"?a.diferencia-b.diferencia:b.diferencia-a.diferencia)||
  groupingKey(a,dimensiones).localeCompare(groupingKey(b,dimensiones)));
 return {estado:"ok",filas:rows.slice(0,30),total_grupos:rows.length};
}
export async function executeResolvedQuestion(pool,ctx,resolution){
 if(resolution.estado!=="ok")return resolution;
 if(!resolution.comparacion){
  const result=await runSemanticQuery(pool,ctx,resolution.consulta);
  return {...resolution,...result};
 }
 const {comparacion}=resolution;
 // Las dos consultas permanecen aisladas por tenant y validadas individualmente.
 const before=await runSemanticQuery(pool,ctx,comparacion.anterior);
 const after=await runSemanticQuery(pool,ctx,comparacion.actual);
 const merged=mergeComparedRows(before.filas,after.filas,comparacion);
 if(merged.estado!=="ok")return {...merged,version:resolution.version};
 return {...resolution,modo:"comparacion_semantica",origen:"PostgreSQL",ficticio:false,
  ...merged,comparacion:{version:comparacion.version,tipo:comparacion.tipo,
   metrica:comparacion.metrica,dimensiones:comparacion.dimensiones,
   anterior:before.periodo,actual:after.periodo,
   unidad:comparacion.metrica==="importe"?"EUR":comparacion.metrica==="unidades"?"unidades":"movimientos"},
  advertencias:[...new Set([...before.advertencias,...after.advertencias,
   "Comparación por grupos con actividad. Los grupos ausentes equivalen a cero movimientos en ese período.",
   "Variación porcentual NULL cuando el período anterior es cero o no hay base comparable."])],
  farmacias_autorizadas:after.farmacias_autorizadas};
}
export async function resolveAndExecuteQuestion(pool,ctx,question,{now}={}){
 const resolution=interpretSemanticQuestion(question,ctx,now?{now}:{});
 return executeResolvedQuestion(pool,ctx,resolution);
}
// Para comparaciones, no dejamos que un modelo de 0,6B cambie el signo,
// divisa o cifras: redacción determinista a partir de los campos auditados.
export function formatComparisonAnswer(data){
 if(data.estado!=="ok")return data.mensaje;
 const {metrica,anterior,actual,unidad}=data.comparacion;
 const number=(n)=>new Intl.NumberFormat("es-ES",{maximumFractionDigits:2,minimumFractionDigits:2}).format(n);
 const format=n=>number(n)+(unidad==="EUR"?" €":" "+unidad);
 if(!data.filas.length)return "No hay actividad registrada en ninguno de los dos períodos comparados.";
 const periods="Del "+actual.desde+" al "+actual.hasta+" frente al "+anterior.desde+" al "+anterior.hasta;
 const lines=data.filas.slice(0,10).map(row=>{
  const id=[row.farmacia,row.vendedorNombre??row.vendedor,row.proveedor,row.producto]
   .filter(x=>x!==undefined&&x!==null&&String(x).trim()).join(" · ")||"Total";
  const pct=row.variacion_pct===null?"sin porcentaje (base cero)":
    (row.variacion_pct>0?"+":"")+number(row.variacion_pct)+" %";
  return id+": "+format(row.actual)+" frente a "+format(row.anterior)+
   " (diferencia "+(row.diferencia>0?"+":"")+format(row.diferencia)+", "+pct+").";
 });
 return periods+". Métrica: "+metrica+".\n"+lines.join("\n")+
 (data.total_grupos>10?"\nSe muestran 10 de "+data.total_grupos+" grupos.":"");
}
