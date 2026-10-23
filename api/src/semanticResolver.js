// Único ejecutor para preguntas en lenguaje natural: MCP OAuth, enlaces temporales
// y chat local comparten interpretación, SQL, comparaciones y verificaciones.
import {interpretSemanticQuestion} from "./semanticInterpreter.js";
import {runSemanticQuery} from "./aiSemanticQuery.js";

const round2=value=>Math.round((value+Number.EPSILON)*100)/100;
// pg devuelve NUMERIC/DECIMAL como texto, nunca asumir que un string es inválido
// ni aceptar cadenas con unidades, comas o valores no finitos.
const num=x=>{
 if(typeof x==="number")return Number.isFinite(x)?x:null;
 if(typeof x==="string"&&/^-?(?:[0-9]+)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(x)){
  const n=Number(x);return Number.isFinite(n)?n:null;
 }
 return null;
};
const hasOwn=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const groupingKey=(row,dims)=>{
 if(dims.includes("farmacia")&&(!Number.isSafeInteger(Number(row.farmaciaId))||
  Number(row.farmaciaId)<=0))throw new TypeError("El resultado no identifica la farmacia");
 if(dims.some(d=>!hasOwn(row,d)))
  throw new TypeError("El resultado no contiene todas las dimensiones solicitadas");
 return JSON.stringify([
  ...(dims.includes("farmacia")?[Number(row.farmaciaId)]:[]),
  ...dims.map(d=>row[d])
 ]);
};
function indexGroups(rows,dims){
 const indexed=new Map();
 for(const row of rows){
  if(!row||typeof row!=="object")throw new TypeError("Fila analítica inválida");
  const key=groupingKey(row,dims);
  if(indexed.has(key))throw new TypeError("Grupos duplicados en la consulta");
  indexed.set(key,row);
 }
 return indexed;
}
function mergeComparedRows(previous,current,{metrica,dimensiones,direccion}){
 if(previous.length>=100||current.length>=100)
  return {estado:"no_disponible",mensaje:"Hay al menos 100 grupos en uno de los períodos. No puedo garantizar una comparación completa con el límite actual; reduce las farmacias o agrupaciones."};
 let prev,now;
 try{
  prev=indexGroups(previous,dimensiones);
  now=indexGroups(current,dimensiones);
 }catch{
  return {estado:"no_disponible",
   mensaje:"Las filas recibidas no permiten comparar grupos con identificadores únicos y verificables."};
 }
 const keys=new Set([...prev.keys(),...now.keys()]);
 const rows=[];
 for(const key of keys){
  const before=prev.get(key),after=now.get(key);
  const a=num(before?.[metrica]),b=num(after?.[metrica]);
  if((before&&a===null)||(after&&b===null))
   return {estado:"no_disponible",mensaje:"La comparación contiene métricas sin valor verificable; no se convierten valores NULL en cero."};
  const values={};
  for(const dim of dimensiones)values[dim]=(after||before)?.[dim]??null;
  if(dimensiones.includes("farmacia"))values.farmaciaId=(after||before)?.farmaciaId??null;
  if(dimensiones.includes("vendedor"))values.vendedorNombre=(after||before)?.vendedorNombre??null;
  // Una fila ausente no demuestra un cero contable: evitar una variación
  // inventada, incluso cuando una farmacia aparece en otro período.
  if(!before||!after){
   rows.push({...values,anterior:before?round2(a):null,actual:after?round2(b):null,
    diferencia:null,variacion_pct:null,
    estado:!before?"sin_datos_anteriores":"sin_datos_actuales"});
   continue;
  }
  rows.push({...values,anterior:round2(a),actual:round2(b),
   diferencia:round2(b-a),
   variacion_pct:a===0?null:round2((b-a)/Math.abs(a)*100),
   estado:"completo"});
 }
 rows.sort((a,b)=>{
  if(a.diferencia===null)return b.diferencia===null?0:1;
  if(b.diferencia===null)return -1;
  return (direccion==="asc"?a.diferencia-b.diferencia:b.diferencia-a.diferencia)||
   groupingKey(a,dimensiones).localeCompare(groupingKey(b,dimensiones));
 });
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
 const days=p=>(Date.parse(p.hasta+"T00:00:00Z")-Date.parse(p.desde+"T00:00:00Z"))/86400000+1;
 const daysNow=days(after.periodo),daysBefore=days(before.periodo);
 return {...resolution,modo:"comparacion_semantica",origen:"PostgreSQL",ficticio:false,
  ...merged,comparacion:{version:comparacion.version,tipo:comparacion.tipo,
   metrica:comparacion.metrica,dimensiones:comparacion.dimensiones,
   anterior:before.periodo,actual:after.periodo,
   dias_actual:daysNow,dias_anterior:daysBefore,
   unidad:comparacion.metrica==="importe"?"EUR":comparacion.metrica==="unidades"?"unidades":"movimientos"},
  advertencias:[...new Set([...before.advertencias,...after.advertencias,
   ...(daysNow!==daysBefore?["Períodos de distinta duración ("+daysNow+
    " frente a "+daysBefore+" días). Totales no normalizados por día."]:[]),
   "Un grupo ausente no se interpreta como importe cero: sus variaciones quedan sin calcular.",
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
  const id=[row.farmacia,row.vendedorNombre??row.vendedor,row.proveedor===null?"Proveedor no identificado":row.proveedor,row.producto]
   .filter(x=>x!==undefined&&x!==null&&String(x).trim()).join(" · ")||"Total";
  if(row.estado!=="completo")return id+": faltan datos verificables de uno de los períodos; variación no calculable.";
  const pct=row.variacion_pct===null?"sin porcentaje (base cero)":
    (row.variacion_pct>0?"+":"")+number(row.variacion_pct)+" %";
  return id+": "+format(row.actual)+" frente a "+format(row.anterior)+
   " (diferencia "+(row.diferencia>0?"+":"")+format(row.diferencia)+", "+pct+").";
 });
 return periods+". Métrica: "+metrica+".\n"+lines.join("\n")+
 (data.total_grupos>10?"\nSe muestran 10 de "+data.total_grupos+" grupos.":"")+
 (data.comparacion.dias_actual!==data.comparacion.dias_anterior?
  "\nAtención: períodos de distinta duración; los totales no están normalizados.":"");
}
