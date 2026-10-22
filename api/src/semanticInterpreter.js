// Interpretación canónica de consultas analíticas: sin IA ni SQL generado.
// El mismo texto, catálogo autorizado y fecha operativa producen el mismo plan.
import {semanticCatalogForContext,validateSemanticQuery} from "./aiSemanticQuery.js";

export const SEMANTIC_LANGUAGE_VERSION="farmetrica.nl.v1";
const months={enero:1,febrero:2,marzo:3,abril:4,mayo:5,junio:6,julio:7,
 agosto:8,septiembre:9,setiembre:9,octubre:10,noviembre:11,diciembre:12};
const norm=s=>String(s).normalize("NFD").replace(/[\u0300-\u036f]/g,"")
 .toLowerCase().replace(/\s+/g," ").trim();
const response=(estado,mensaje,more={})=>({version:SEMANTIC_LANGUAGE_VERSION,estado,mensaje,...more});
const day=(y,m,d)=>{
 const date=new Date(Date.UTC(Number(y),Number(m)-1,Number(d)));
 if(Number(y)<2000||Number(y)>2100||date.getUTCFullYear()!==Number(y)||
    date.getUTCMonth()!==Number(m)-1||date.getUTCDate()!==Number(d))return null;
 return [y,String(m).padStart(2,"0"),String(d).padStart(2,"0")].join("-");
};
const endMonth=(y,m)=>new Date(Date.UTC(y,m,0)).getUTCDate();
const madridDate=now=>{
 const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Madrid",
  year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(now);
 const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));
 return p.year+"-"+p.month+"-"+p.day;
};
const datesRegex=new RegExp("\\b(\\d{1,2})\\s+de\\s+("+Object.keys(months).join("|")+
 ")\\s+(?:de|del)\\s+(20\\d{2})\\b","g");
function readPeriod(q,now){
 const full=[];
 for(const m of q.matchAll(datesRegex)){
  const d=day(Number(m[3]),months[m[2]],Number(m[1]));
  if(!d)return response("aclaracion","La fecha indicada no existe.");
  full.push(d);
 }
 for(const m of q.matchAll(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/g)){
  const d=day(Number(m[3]),Number(m[2]),Number(m[1]));
  if(!d)return response("aclaracion","La fecha indicada no existe.");
  full.push(d);
 }
 if(full.length>2)return response("aclaracion","Indica un único intervalo de fechas.");
 if(full.length===2){
  if(!/\b(desde|hasta|entre)\b/.test(q))
   return response("aclaracion","¿Quieres un intervalo o comparar los dos días?");
  if(full[0]>full[1])return response("aclaracion","La fecha inicial es posterior a la final.");
  return {desde:full[0],hasta:full[1]};
 }
 if(full.length===1){
  // "entre el 1 y el 22 de octubre de 2026" / "del 1 al 22 de octubre de 2026".
  const range=q.match(/\b(?:entre\s+(?:el\s+)?|del\s+)(\d{1,2})\s+(?:y\s+(?:el\s+)?|al\s+(?:el\s+)?)\d{1,2}\s+de\s+([a-z]+)\s+(?:de|del)\s+(20\d{2})\b/);
  if(range){
   const first=day(Number(range[3]),months[range[2]],Number(range[1]));
   if(!first||first>full[0])return response("aclaracion","Intervalo de fechas inválido.");
   return {desde:first,hasta:full[0]};
  }
  const inferred=q.match(/\bdesde\s+(?:el\s+)?(\d{1,2})\s+de\s+([a-z]+)\s+(?:hasta|al)\b/);
  if(inferred){
   const first=day(Number(full[0].slice(0,4)),months[inferred[2]],Number(inferred[1]));
   if(!first||first>full[0])return response("aclaracion","El intervalo no es válido.");
   return {desde:first,hasta:full[0]};
  }
  if(/\b(desde|hasta|entre)\b/.test(q))
   return response("aclaracion","Indica ambas fechas del intervalo.");
  return {desde:full[0],hasta:full[0]};
 }
 const m=[...q.matchAll(new RegExp("\\b("+Object.keys(months).join("|")+")\\s+(?:de\\s+)?(20\\d{2})\\b","g"))];
 if(m.length>1)return response("aclaracion","Indica un solo mes o un intervalo con fechas completas.");
 if(m.length===1){
  const y=Number(m[0][2]),mo=months[m[0][1]];
  return {desde:day(y,mo,1),hasta:day(y,mo,endMonth(y,mo))};
 }
 if(/\banteayer\b/.test(q)||/\btrimestre|semestre\b/.test(q))
  return response("no_disponible","Expresa ese período mediante fechas de inicio y fin.");
 const rel=[
  [/\bhoy\b/,"hoy"],[/\bayer\b/,"ayer"],
  [/\besta semana\b/,"esta_semana"],[/\bsemana pasada\b/,"semana_pasada"],
  [/\b(este mes|mes actual)\b/,"este_mes"],[/\b(mes pasado|mes anterior)\b/,"mes_pasado"],
  [/\b(este ano|este anio|ano actual)\b/,"este_anio"],
  [/\bultimos 7 dias\b/,"ultimos_7_dias"],[/\bultimos 30 dias\b/,"ultimos_30_dias"],
  [/\bultimos 90 dias\b/,"ultimos_90_dias"],[/\bultimos 365 dias\b/,"ultimos_365_dias"],
  [/\b(historico|todos los anos|desde siempre)\b/,"historico"]
 ];
 const found=rel.filter(([pattern])=>pattern.test(q));
 if(found.length>1)return response("aclaracion","Has indicado varios períodos. Selecciona uno.");
 if(found.length===1)return {periodo:found[0][1]};
 if(/\b(ano pasado|anio pasado)\b/.test(q)){
  const y=Number(madridDate(now).slice(0,4))-1;
  return {desde:y+"-01-01",hasta:y+"-12-31"};
 }
 const years=[...q.matchAll(/\b(20\d{2})\b/g)];
 if(years.length>1)return response("aclaracion","Indica un único año o un intervalo de fechas.");
 if(years.length===1)return {desde:years[0][1]+"-01-01",hasta:years[0][1]+"-12-31"};
 return null;
}
const SOURCES={
 ventas:/\b(ventas?|vendid[oa]s?|vendieron|vendemos|vendimos|vendio|vender|facturacion|facturad[oa]s?|facturamos)\b/,
 compras:/\b(compras?|comprad[oa]s?|compramos|comprar|recepciones?|proveedor(?:es)?)\b/,
 stock:/\b(stock|existencias?|inventario|almacen)\b/
};
const DIMENSIONS={
 farmacia:/\bfarmacias?\b/,vendedor:/\b(vendedor(?:es)?|vendedora(?:s)?|comercial(?:es)?)\b/,
 producto:/\b(productos?|articulos?)\b/,proveedor:/\bproveedor(?:es)?\b/,
 dia:/\b(dias?|diariamente)\b/,mes:/\b(meses?|mensualmente)\b/,
 anio:/\b(anos?|anios?|anualmente)\b/
};
const GROUP={
 farmacia:/\b(por|cada|segun)\s+(?:la|las|el|los)?\s*farmacias?\b/,
 vendedor:/\b(por|cada|segun)\s+(?:el|los|la|las)?\s*(vendedor(?:es)?|vendedora(?:s)?|comercial(?:es)?)\b/,
 producto:/\b(por|cada|segun)\s+(?:el|los|la|las)?\s*(productos?|articulos?)\b/,
 proveedor:/\b(por|cada|segun|a cada)\s+(?:el|los|la|las)?\s*proveedor(?:es)?\b/,
 dia:/\b(por|cada)\s+(?:el|los)?\s*dias?\b/,
 mes:/\b(por|cada)\s+(?:el|los)?\s*mes(?:es)?\b/,
 anio:/\b(por|cada)\s+(?:el|los)?\s*(anos?|anios?)\b/
};
function pharmacyScope(q,ctx){
 const pharmacies=(ctx.pharmacies||[]).filter(p=>norm(p.name).length>2&&q.includes(norm(p.name)));
 if(pharmacies.length>1)return response("aclaracion","Indica si quieres comparar esas farmacias o consultar una sola.");
 if(pharmacies.length===1)return [Number(pharmacies[0].id)];
 if(/\bfarmacia\s+(de|del|llamada)\s+\w+/.test(q)&&
   !/\bfarmacia\s+(de hoy|del mes)\b/.test(q))
  return response("aclaracion","La farmacia indicada no coincide con las autorizadas. Escribe su nombre exacto.");
 return undefined;
}
export function interpretSemanticQuestion(question,ctx,{now=new Date()}={}){
 if(typeof question!=="string"||question.trim().length<2||question.length>1000)
  return response("aclaracion","La pregunta debe tener entre 2 y 1.000 caracteres.");
 const q=norm(question),catalog=semanticCatalogForContext(ctx);
 if(/\b(beneficio|beneficios|rentabilidad|stock inmovilizado|beneficio neto)\b/.test(q))
  return response("no_disponible","La pregunta requiere datos contables que no figuran en este contrato. No los sustituiré por ventas.");
 if(/\b(comparar|comparacion|comparativa|diferencia|variacion|crecimiento|evolucion|respecto|versus|frente a)\b/.test(q))
  return response("no_disponible","La comparación entre períodos todavía no está definida en este intérprete. No inventaré variaciones.");
 if(/\bmargen\b/.test(q)&&!/\bestimad[oa]\b/.test(q))
  return response("aclaracion","¿Te refieres al margen estimado con coste PMC actual, no al beneficio contable?");
 const found=Object.entries(SOURCES).filter(([,p])=>p.test(q)).map(([k])=>k);
 if(!found.length)return response("general","La pregunta no exige una consulta analítica identificable.");
 if(found.length>1)return response("aclaracion",
  "La pregunta mezcla fuentes ("+found.join(", ")+"). Indica qué fuente quieres consultar.");
 const fuente=found[0],meta=catalog.fuentes[fuente];
 if(!meta)return response("no_disponible","No tienes permiso para consultar "+fuente+".");
 if(/\bmargen\b/.test(q)&&!/\bestimad[oa]\b/.test(q))
  return response("aclaracion","¿Te refieres al margen estimado con coste PMC actual, no al beneficio contable?");
 const period=readPeriod(q,now);
 if(period?.estado)return period;
 if(fuente!=="stock"&&!period)
  return response("aclaracion","Indica un período: hoy, este mes o fechas de inicio y fin.");
 if(fuente==="stock"&&period)
  return response("no_disponible","El stock es actual: no puede consultarse históricamente.");
 const scope=pharmacyScope(q,ctx);
 if(scope?.estado)return scope;
 const rank=/\b(mas|menos|mayores|menores|ranking|top|mejores|peores)\b/.test(q);
 const agrupar=[];
 for(const [dim,pattern] of Object.entries(GROUP)){
  const inferred=rank&&["vendedor","producto","proveedor"].includes(dim)&&DIMENSIONS[dim].test(q);
  if(meta.dimensiones.includes(dim)&&(pattern.test(q)||inferred))agrupar.push(dim);
 }
 if(fuente==="ventas"&&agrupar.includes("vendedor")&&!agrupar.includes("farmacia"))
  agrupar.unshift("farmacia");
 if(agrupar.length>3)return response("no_disponible","La consulta pide más de tres dimensiones.");
 let metricas;
 if(fuente==="stock"){
  metricas=/\b(cobertura|dias de stock)\b/.test(q)?["dias_cobertura"]:
   /\b(valor|capital|euros|importe)\b/.test(q)?["capital_estimado"]:["stock_actual"];
 }else if(/\bmargen estimad[oa]\b/.test(q)){
  if(fuente!=="ventas")return response("no_disponible","El margen estimado solo está definido en ventas.");
  metricas=["margen_estimado"];
 }else if(/\b(tickets?|movimientos?|operaciones?|transacciones?|lineas?)\b/.test(q)){
  metricas=["movimientos"];
 }else if(/\b(unidades?|cantidad|volumen)\b/.test(q)&&!/\b(importe|euros|facturacion)\b/.test(q)){
  metricas=["unidades"];
 }else if(rank&&fuente==="ventas"&&agrupar.includes("producto")){
  metricas=["unidades"];
 }else metricas=["importe"];
 if(metricas.some(m=>!Object.hasOwn(meta.metricas,m)))
  return response("no_disponible","Esa métrica no está disponible para la fuente indicada.");
 const consulta={fuente,agrupar,metricas,...(period||{})};
 if(scope)consulta.farmacias=scope;
 if(rank&&agrupar.length){
  consulta.ordenar={campo:metricas[0],direccion:/\b(menos|menores|peores)\b/.test(q)?"asc":"desc"};
  const size=q.match(/\b(?:top|primeros?|primeras?)\s+(\d{1,3})\b/);
  consulta.limite=size?Number(size[1]):30;
  if(consulta.limite<1||consulta.limite>100)
   return response("aclaracion","Indica un ranking de 1 a 100 elementos.");
 }
 try{validateSemanticQuery(consulta,ctx);}
 catch(error){return response("no_disponible","Consulta no autorizada por el contrato: "+error.message);}
 return response("ok","Consulta interpretada por Farmétrica.",{consulta,
  interpretacion:{fuente,dimensiones:agrupar,metricas,periodo:period||null}});
}
