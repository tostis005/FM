// El asistente usa el mismo contrato semántico de solo lectura que el MCP
// temporal. El planificador LLM heredado no se usa en la ruta principal; SQL auditado.
import {semanticCatalogForContext,validateSemanticQuery,runSemanticQuery} from "./aiSemanticQuery.js";

export function semanticPlannerPrompt(context){
 const catalog=semanticCatalogForContext(context);
 const available=Object.fromEntries(Object.entries(catalog.fuentes).map(([key,value])=>[key,{
  dimensiones:value.dimensiones,metricas:Object.keys(value.metricas),
  descripcion:value.descripcion
 }]));
 const allowed=new Set(context.allowedPharmacyIds.map(Number));
 const pharmacies=(context.pharmacies||[]).filter(p=>allowed.has(Number(p.id)))
  .map(p=>({id:Number(p.id),nombre:p.name}));
 const specs={
  fuentes:available,
  farmacias:pharmacies,
  periodos:["hoy","ayer","esta_semana","semana_pasada","este_mes","mes_pasado","este_anio",
   "historico","ultimos_7_dias","ultimos_30_dias","ultimos_90_dias","ultimos_365_dias"],
  filtros:["farmacias","producto","vendedor","proveedor","estado_stock","dias_max"],
  ejemplos:catalog.ejemplos.slice(0,5)
 };
 return [
  "Eres el planificador de consultas del asistente Farmétrica. Identifica qué datos",
  "reales necesitas para contestar la pregunta del usuario. Usa SOLO el catálogo",
  "MCP autorizado. Jamás generes SQL, inventes fuentes, métricas o columnas.",
  "Responde ÚNICAMENTE JSON con la forma exacta: {\"consultas\":[{...}]}",
  "Cada consulta sigue el contrato MCP: fuente, agrupar, metricas, periodo o",
  "desde y hasta, filtros, ordenar y limite. Máximo tres consultas diferentes.",
  "Para ranking incluye ordenar y limite. Para vendedor agrupa también farmacia.",
  "Si una pregunta es conceptual y no necesita datos privados devuelve",
  "{\"consultas\":[]}. Si ninguna fuente tiene la información pedida, devuelve",
  "{\"consultas\":[]} y no inventes equivalencias.",
  "El stock es actual; no admite periodos históricos.",
  "Las fechas relativas usan Europe/Madrid.",
  "CATALOGO_MCP="+JSON.stringify(specs)
 ].join(" ");
}

export function parseSemanticPlans(text,context){
 if(typeof text!=="string"||text.length>12000)throw new TypeError("Plan MCP inválido");
 const cleaned=text.trim().replace(/^\`\`\`(?:json)?\s*/i,"").replace(/\s*\`\`\`$/,"");
 let parsed;
 try{parsed=JSON.parse(cleaned);}
 catch {throw new TypeError("Qwen no ha devuelto un plan JSON válido");}
 if(!parsed||typeof parsed!=="object"||Array.isArray(parsed)||
  !Array.isArray(parsed.consultas)||parsed.consultas.length>3)
  throw new TypeError("El plan de consultas MCP no es válido");
 // La validación es exactamente la misma que usa el MCP temporal.
 for(const query of parsed.consultas)validateSemanticQuery(query,context);
 return parsed.consultas;
}

export async function runAssistantSemanticQueries(pool,context,queries){
 const answers=[];
 for(const query of queries){
  try{
   const response=await runSemanticQuery(pool,context,query);
   answers.push({
    tool:"consulta_semantica_"+response.fuente,
    label:"MCP · "+response.fuente,
    available:true,period:response.periodo,
    pharmacies:response.farmacias_autorizadas,
    metrics:response.metricas,
    dimensions:response.dimensiones,
    warnings:response.advertencias,
    rows:response.filas
   });
  }catch(error){
   // No trasladar SQL, nombres de esquemas ni errores privados al modelo.
   console.error("Asistente MCP:",error?.code||error?.name||"error");
   answers.push({tool:"consulta_semantica_"+query.fuente,
    label:"MCP · "+query.fuente,available:false,
    reason:"No se han podido consultar los datos de "+query.fuente+" en este momento."});
  }
 }
 return answers;
}
