// Contexto reconstruido solo de preguntas del usuario: sin confiar en texto
// generado por Qwen, sin SQL libre y sin estado que mezcle conversaciones.
import {interpretSemanticQuestion,SEMANTIC_LANGUAGE_VERSION} from "./semanticInterpreter.js";
import {validateSemanticQuery} from "./aiSemanticQuery.js";

const norm=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"")
 .toLowerCase().replace(/[¿?¡!.,:;]+/g," ").replace(/\s+/g," ").trim();
const PERIOD=/\b(hoy|ayer|este mes|mes actual|mes pasado|mes anterior|este ano|este anio|ano pasado|anio pasado|esta semana|semana pasada|ultimos? \d+ dias?|pasados? \d+ dias?|desde|hasta|entre|20\d{2}|historico|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/;
const DIMS=/\b(?:por|cada)\s+(?:(?:el|la|los|las)\s+)?(?:farmacias?|vendedor(?:es)?|vendedoras?|proveedor(?:es)?|productos?|articulos?|dias?|fechas?|meses?|anos?|anios?)\b/;
const FOLLOW=/^(?:y\b|ahora\b|lo mismo\b|que hay de\b|en cambio\b|para\b|respecto a\b)/;
const SOURCES={ventas:/\b(ventas?|vendieron|vendimos|vendido|vendida|vendedor(?:es)?|facturacion|facturado)\b/,
 compras:/\b(compras?|compramos|comprado|comprada|proveedor(?:es)?|gastamos|gastado|gasto)\b/,
 stock:/\b(stock|existencias?|inventario)\b/};
const sourceOf=q=>{
 const match=Object.entries(SOURCES).filter(([,re])=>re.test(q));
 return match.length===1?match[0][0]:null;
};
const periodOf=c=>Object.fromEntries(["periodo","desde","hasta"]
 .filter(k=>c[k]!==undefined).map(k=>[k,c[k]]));
const periodText=c=>c.periodo?c.periodo.replaceAll("_"," "):
 c.desde&&c.hasta?("desde "+c.desde.split("-").reverse().join("/")+
 " hasta "+c.hasta.split("-").reverse().join("/")):"";
function continueFrom(previous,question,ctx,now){
 if(!previous?.consulta||previous.comparacion)return null;
 const q=norm(question);
 if(!FOLLOW.test(q)&&!(sourceOf(q)===null&&PERIOD.test(q)&&q.split(/\s+/).length<=5))
  return null;
 const prior=previous.consulta,source=sourceOf(q)||prior.fuente;
 const fragment=q.replace(/^(?:y|ahora|lo mismo|en cambio)\s*/,"").trim();
 const hasPeriod=PERIOD.test(fragment),hasDimension=DIMS.test(fragment);
 const switched=source!==prior.fuente;
 const probe=interpretSemanticQuestion(source+" "+fragment+
  (hasPeriod?"":" "+periodText(prior)),ctx,{now});
 if(probe.estado!=="ok")return null;
 const candidate=probe.consulta;
 // No sustituir silenciosamente una farmacia nombrada por la anterior si
 // el nombre no pertenece a las farmacias autorizadas para este usuario.
 const namedPharmacy=/\b(?:en|de|para)\s+(?!el\b|la\b|los\b|las\b|este\b|esta\b|un\b|una\b|mes\b|ano\b|anio\b|hoy\b|ayer\b)([a-z][a-z0-9-]*)\b/.test(fragment);
 if(namedPharmacy&&!candidate.farmacias&&!/\bproveedor\b/.test(fragment))return null;
 const changedPeriod=hasPeriod?periodOf(candidate):periodOf(prior);
 const merged={...prior,
  fuente:source,
  agrupar:hasDimension?candidate.agrupar:switched?
   prior.agrupar.filter(d=>!["vendedor","proveedor"].includes(d)):prior.agrupar,
  metricas:switched||/\b(?:unidades?|cantidad|movimientos?|tickets?|margen estimado|porcentaje)\b/.test(fragment)?
   candidate.metricas:prior.metricas};
 if(hasPeriod){delete merged.periodo;delete merged.desde;delete merged.hasta;}
 Object.assign(merged,changedPeriod);
 if(candidate.farmacias)merged.farmacias=candidate.farmacias;
 else if(/\b(?:todas las farmacias|todas)\b/.test(fragment))delete merged.farmacias;
 if(switched){delete merged.producto;delete merged.proveedor;}
 for(const key of ["producto","proveedor"])if(candidate[key]!==undefined)merged[key]=candidate[key];
 if(hasDimension){delete merged.ordenar;delete merged.limite;}
 if(candidate.ordenar)merged.ordenar=candidate.ordenar;
 if(candidate.limite!==undefined)merged.limite=candidate.limite;
 try{validateSemanticQuery(merged,ctx);}catch{return null;}
 return {version:SEMANTIC_LANGUAGE_VERSION,estado:"ok",
  mensaje:"Consulta interpretada con contexto.",consulta:merged,
  interpretacion:{fuente:merged.fuente,dimensiones:merged.agrupar,
   metricas:merged.metricas,periodo:periodOf(merged)},contextual:true};
}
export function resolveConversationQuestion(question,history,ctx,{now=new Date()}={}){
 const users=(Array.isArray(history)?history:[])
  .filter(m=>m?.role==="user"&&typeof m.content==="string").slice(-8);
 let previous=null;
 for(const message of users){
  const standalone=interpretSemanticQuestion(message.content,ctx,{now});
  if(standalone.estado==="ok")previous=standalone;
  else previous=continueFrom(previous,message.content,ctx,now)||previous;
 }
 const standalone=interpretSemanticQuestion(question,ctx,{now});
 return continueFrom(previous,question,ctx,now)||standalone;
}
