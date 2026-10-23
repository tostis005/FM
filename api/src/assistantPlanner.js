import {semanticCatalogForContext,validateSemanticQuery} from "./aiSemanticQuery.js";
import {interpretSemanticQuestion} from "./semanticInterpreter.js";
import {resolveConversationQuestion} from "./assistantConversation.js";

// La IA solo propone un plan permitido. Nunca recibe un ejecutor SQL ni
// credenciales; el compilador semántico conserva límites y permisos.
const norm=s=>String(s??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"")
 .toLowerCase();
const TIME=/\b(hoy|ayer|semana|mes|ano|anio|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|20\d{2}|historico|ultimos|pasados)\b/;
const BLOCKED=/\b(beneficio neto|rentabilidad|stock historico|pvp vigente|precio actual|tarifa actual|precio de catalogo)\b/;
const SOURCE={
 ventas:/\b(ventas?|vendid[oa]s?|facturac\w*|productos? mas vendidos|precios? de venta)\b/,
 compras:/\b(compras?|comprad[oa]s?|proveedores?|gasto|gastamos|recepciones?)\b/,
 stock:/\b(stock|existencias?|inventario)\b/
};
const periodOf=p=>Object.fromEntries(["periodo","desde","hasta"].filter(k=>p?.[k]!==undefined)
 .map(k=>[k,p[k]]));
export function parseProposedPlan(raw,ctx,{question="",previous=null,now=new Date()}={}){
 if(typeof raw!=="string"||raw.length>5000)return null;
 let proposal;
 try{proposal=JSON.parse(raw);if(proposal?.consulta)proposal=proposal.consulta}
 catch{return null}
 if(!proposal||typeof proposal!=="object"||Array.isArray(proposal))return null;
 const q=norm(question);
 if(BLOCKED.test(q))return null;
 const sources=Object.entries(SOURCE).filter(([,pattern])=>pattern.test(q)).map(([key])=>key);
 if(sources.length>1||sources.length===1&&proposal.fuente!==sources[0])return null;
 if(sources.length===0&&previous?.consulta&&proposal.fuente!==previous.consulta.fuente)return null;
 const plan={...proposal};
 const previousPeriod=periodOf(previous?.consulta);
 if(!TIME.test(q)){
  if(previous?.consulta?.fuente===plan.fuente&&Object.keys(previousPeriod).length){
   delete plan.periodo;delete plan.desde;delete plan.hasta;
   Object.assign(plan,previousPeriod);
  }else if(plan.fuente!=="stock")return null;
 }else{
  const canonical=interpretSemanticQuestion(plan.fuente+" "+question,ctx,{now});
  if(canonical.estado==="ok"&&canonical.consulta?.fuente===plan.fuente){
   delete plan.periodo;delete plan.desde;delete plan.hasta;
   Object.assign(plan,periodOf(canonical.consulta));
  }
 }
 if(previous?.consulta?.farmacias&&!/\btodas las farmacias\b/.test(q))
  plan.farmacias=previous.consulta.farmacias;
 // Fechas, nombres y métricas deberán además superar el validador real.
 try{validateSemanticQuery(plan,ctx)}catch{return null}
 return plan;
}
export function shouldTryAssistantPlanner(question,resolution){
 const q=norm(question);
 if(BLOCKED.test(q))return false;
 if(resolution?.estado==="ok")return /\bprecios?\b/.test(q)&&
  resolution.consulta?.fuente==="ventas"&&
  !resolution.consulta?.metricas?.includes("precio_medio");
 if(!["general","aclaracion","no_disponible"].includes(resolution?.estado))return false;
 if(/\bbeneficio|rentabilidad|stock historico\b/.test(q))return false;
 if(resolution.estado==="aclaracion"&&!TIME.test(q)&&!/\bstock\b/.test(q))return false;
 return true;
}
export function plannerPrompt(question,history,ctx,{now=new Date()}={}){
 const catalog=semanticCatalogForContext(ctx);
 const sources=Object.fromEntries(Object.entries(catalog.fuentes||{}).map(([key,info])=>
  [key,{dimensiones:info.dimensiones,metricas:Object.keys(info.metricas)}]));
 const recent=(Array.isArray(history)?history:[]).filter(x=>x?.role==="user")
  .slice(-5).map(x=>String(x.content).slice(0,250));
 const context={
  fecha_madrid:new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Madrid",year:"numeric",
   month:"2-digit",day:"2-digit"}).format(now),
  fuentes:sources,pregunta:question.slice(0,1000),preguntas_anteriores:recent,
  ejemplo:{fuente:"ventas",agrupar:["farmacia","producto"],
   metricas:["unidades","importe","precio_medio"],periodo:"este_mes",
   ordenar:{campo:"unidades",direccion:"desc"},limite:20}
 };
 return [
  {role:"system",content:[
   "Eres un planificador de Farmétrica. Devuelve SOLO JSON de una consulta, nunca SQL.",
   "Usa SOLO fuentes, dimensiones y métricas del catálogo. No inventes tablas.",
   "Propiedades: fuente, agrupar, metricas, periodo o desde/hasta, producto, proveedor, vendedor, ordenar, limite.",
   "precio_medio significa importe vendido dividido por unidades, no PVP actual.",
   "Conserva la farmacia, el producto y el período de la pregunta anterior en repreguntas.",
   "No inventes fechas ni filtros. Si no se puede, responde {}."
  ].join(" ")},
  {role:"user",content:JSON.stringify(context)}
 ];
}
export function previousResolvedQuestion(history,ctx,{now=new Date()}={}){
 const users=(Array.isArray(history)?history:[]).filter(x=>x?.role==="user"&&typeof x.content==="string");
 if(!users.length)return null;
 const previous=resolveConversationQuestion(users.at(-1).content,users.slice(0,-1),ctx,{now});
 return previous.estado==="ok"&&!previous.comparacion?previous:null;
}
