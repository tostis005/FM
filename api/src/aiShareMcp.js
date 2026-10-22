// MCP sin OAuth para trabajar DESDE ChatGPT con el enlace temporal que el usuario pega.
// El endpoint estable solo anuncia herramientas; TODAS las operaciones de datos
// exigen el enlace revocable y lo verifican contra su hash antes de consultar PostgreSQL.
import {loadDemoMcpContext} from "./aiMcpDemo.js";
import {semanticCatalogForContext,runSemanticQuery,SEMANTIC_MCP_QUERY_SCHEMA} from "./aiSemanticQuery.js";
import {makeTemporaryModel} from "./aiShareContract.js";
import {interpretSemanticQuestion} from "./semanticInterpreter.js";

const ROOT="https://farmetrica.com/api/consulta-temporal/";
const RE=/^fm_share_[A-Za-z0-9_-]{43}$/;
const SCHEMA_URL={type:"string",description:"URL temporal de Farmétrica copiada por el usuario; nunca otra URL."};
const tools=[
 {name:"resolver_pregunta_temporal",description:"MÉTODO RECOMENDADO: envía la pregunta en español literalmente. Farmétrica interpreta fuente, métricas, dimensiones y fechas con reglas únicas independientes de la IA; ejecuta SQL seguro y devuelve el resultado. Si hay ambigüedad devuelve aclaración, no datos inventados.",annotations:{readOnlyHint:true,openWorldHint:false},
  inputSchema:{type:"object",properties:{url:SCHEMA_URL,pregunta:{type:"string",minLength:2,maxLength:1000}},required:["url","pregunta"],additionalProperties:false}},
 {name:"leer_modelo_temporal",description:"Consulta el catálogo único y las definiciones auditadas. Para preguntas en español utiliza resolver_pregunta_temporal, que evita planes distintos entre modelos.",annotations:{readOnlyHint:true,openWorldHint:false},
  inputSchema:{type:"object",properties:{url:SCHEMA_URL},required:["url"],additionalProperties:false}},
 {name:"consultar_datos_temporales",description:"Consulta avanzada para clientes que proporcionen planes estructurados explícitos validados por Farmétrica; preferir resolver_pregunta_temporal cuando se parte de texto libre.",annotations:{readOnlyHint:true,openWorldHint:false},
  inputSchema:{type:"object",properties:{url:SCHEMA_URL,consulta:SEMANTIC_MCP_QUERY_SCHEMA},
   required:["url","consulta"],additionalProperties:false}}
];
const fail=(id,code,msg)=>({jsonrpc:"2.0",id,error:{code,message:msg}});
const textResult=(id,data)=>({jsonrpc:"2.0",id,result:{
  content:[{type:"text",text:JSON.stringify(data)}],structuredContent:data}});
const toolError=(id,msg)=>({jsonrpc:"2.0",id,result:{isError:true,
 content:[{type:"text",text:msg}]}});
export function parseShareUrl(url){
 if(typeof url!=="string"||url.length>220)throw new TypeError("URL temporal inválida");
 let p;
 try{p=new URL(url)}catch{throw new TypeError("URL temporal inválida")}
 if(p.origin!=="https://farmetrica.com"||p.username||p.password||p.search||p.hash||
  !p.pathname.startsWith("/api/consulta-temporal/"))
  throw new TypeError("Utiliza la URL temporal raíz de farmetrica.com, sin parámetros");
 const token=p.pathname.slice("/api/consulta-temporal/".length);
 if(!RE.test(token))throw new TypeError("Identificador del enlace temporal inválido");
 return token;
}
const limited=new Map();
function admit(token){
 const now=Date.now(),list=(limited.get(token)||[]).filter(d=>now-d<600000);
 if(list.length>=100)return false;
 list.push(now);limited.set(token,list);
 if(limited.size>500)for(const [k,v] of limited)if(now-v.at(-1)>600000)limited.delete(k);
 return true;
}
export function setupShareMcp(app,pool,{resolveLink}){
 const endpoint="/api/consulta-temporal/mcp";
 app.post(endpoint,async(req,res)=>{
  res.set("Cache-Control","private, no-store, no-cache, max-age=0, must-revalidate")
   .set("CDN-Cache-Control","no-store").set("Surrogate-Control","no-store")
   .set("Pragma","no-cache").set("Expires","0").set("X-Accel-Expires","0")
   .set("Referrer-Policy","no-referrer")
   .set("X-Robots-Tag","noindex, nofollow")
   .set("X-Content-Type-Options","nosniff");
  if(Number(req.get("content-length")||0)>16384)return res.status(413).end();
  const b=req.body,id=b?.id??null;
  if(!b||typeof b!=="object"||Array.isArray(b)||b.jsonrpc!=="2.0"||typeof b.method!=="string")
   return res.status(400).json(fail(id,-32600,"Invalid Request"));
  if(["notifications/initialized","notifications/cancelled"].includes(b.method))
   return res.status(202).end();
  if(b.method==="initialize")return res.json({jsonrpc:"2.0",id,result:{
   protocolVersion:"2025-06-18",capabilities:{tools:{listChanged:false}},
   serverInfo:{name:"Farmetrica Temporary Link",version:"1.0.0"}}});
  if(b.method==="ping")return res.json({jsonrpc:"2.0",id,result:{}});
  if(b.method==="tools/list")return res.json({jsonrpc:"2.0",id,result:{tools}});
  if(b.method!=="tools/call")return res.json(fail(id,-32601,"Method not found"));
  const name=b.params?.name,args=b.params?.arguments;
  if(!tools.some(t=>t.name===name)||!args||typeof args!=="object"||Array.isArray(args)||
     Object.keys(args).some(x=>!["url",...(name==="consultar_datos_temporales"?["consulta"]:name==="resolver_pregunta_temporal"?["pregunta"]:[])].includes(x)))
   return res.json(toolError(id,"Herramienta o argumentos no permitidos"));
  try{
   const token=parseShareUrl(args.url);
   if(!admit(token))return res.status(429).json(fail(id,-32000,"Demasiadas consultas"));
   const slug=await resolveLink(token);
   if(!slug)return res.json(toolError(id,"Enlace temporal caducado o revocado; genera otro desde Farmétrica"));
   const ctx=await loadDemoMcpContext(pool,slug);
   if(name==="leer_modelo_temporal")
    return res.json(textResult(id,makeTemporaryModel(ctx,ROOT+token)));
   if(name==="resolver_pregunta_temporal"){
    const interpretation=interpretSemanticQuestion(args.pregunta,ctx);
    if(interpretation.estado!=="ok")
     return res.json(textResult(id,{...interpretation,origen:"Farmétrica",
      soloLectura:true,cliente:ctx.client.name}));
    const result=await runSemanticQuery(pool,ctx,interpretation.consulta);
    return res.json(textResult(id,{...interpretation,...result,
      cliente:ctx.client.name,origen:"PostgreSQL",ficticio:false}));
   }
   if(!args.consulta||typeof args.consulta!=="object"||Array.isArray(args.consulta)||
     JSON.stringify(args.consulta).length>6000)
    return res.json(toolError(id,"Consulta semántica inválida; lee primero el modelo"));
   const data=await runSemanticQuery(pool,ctx,args.consulta);
   return res.json(textResult(id,{...data,cliente:ctx.client.name,fuentes_analiticas:semanticCatalogForContext(ctx).fuentes}));
  }catch(e){
   if(e instanceof TypeError||e.status===400)return res.json(toolError(id,"Corrige el plan según el contrato: "+e.message));
   if(["57014","55P03"].includes(e.code))
    return res.json(toolError(id,"Consulta demasiado costosa. Reduce período o filtros."));
   console.error("MCP temporal:",e?.code||e?.name||"error");
   return res.status(503).json(fail(id,-32000,"Error consultando los datos"));
  }
 });
 app.get(endpoint,(_req,res)=>res.status(405).set("Allow","POST").end());
 app.delete(endpoint,(_req,res)=>res.status(204).end());
}
export {tools as SHARE_MCP_TOOLS};
