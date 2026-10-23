#!/usr/bin/env node
// Comparativa Farmétrica: una consulta MCP por pregunta; mismos datos para cada modelo.
// El secreto FM_TEMP_LINK nunca se envía a Ollama.
const env=process.env;
const link=env.FM_TEMP_LINK||"";
const mcpURL=env.FM_MCP_URL||"http://127.0.0.1:8000/api/consulta-temporal/mcp";
const ollamaURL=env.FM_OLLAMA_URL||"http://ollama:11434";
const models=(env.FM_MODELS||"qwen3:0.6b,qwen3:1.7b,llama3.2:1b,gemma3:1b").split(",").map(x=>x.trim()).filter(Boolean);
const cases=[
 "¿Cuánto vendió cada farmacia el 22 de octubre de 2026?",
 "¿Qué vendedores vendieron más desde el 1 de enero hasta el 22 de octubre de 2026?",
 "¿Cuánto compramos a cada proveedor entre el 1 y el 22 de octubre de 2026?",
 "Compara las ventas por farmacia del 1 al 15 de octubre de 2026 con las del 1 al 15 de septiembre de 2026"
];
const ids=(env.FM_CASES||"1,2,3,4").split(",").map(Number);
const repeats=Number(env.FM_REPS||1),maxRows=Number(env.FM_MAX_ROWS||5);
const nPredict=Number(env.FM_NUM_PREDICT||350);
if(!/^https:\/\/farmetrica\.com\/api\/consulta-temporal\/fm_share_[\w-]{43}$/.test(link))throw Error("FM_TEMP_LINK es inválido o no es la URL raíz");
if(!models.length||models.length>8||models.some(x=>!/^[\w.:-]+$/.test(x)))throw Error("FM_MODELS inválido");
if(!ids.length||new Set(ids).size!==ids.length||ids.some(i=>!Number.isInteger(i)||i<1||i>4))throw Error("FM_CASES debe indicar números 1..4 sin repetir");
if(!Number.isInteger(repeats)||repeats<1||repeats>4||maxRows<1||maxRows>10||nPredict<100||nPredict>1000)throw Error("Repeticiones, filas o tokens fuera de rango");
const safe=x=>String(x).replaceAll(link,"[URL OCULTA]").replaceAll(link.slice(-43),"[TOKEN OCULTO]");
const round=x=>Math.round(x*100)/100;
const columns=["farmaciaId","farmacia","vendedor","vendedorNombre","proveedor","producto","importe","unidades","movimientos","anterior","actual","diferencia","variacion_pct","estado"];
const system=[
 "Eres redactor farmacéutico. Farmétrica ya calculó los resultados. No crees consultas.",
 "Devuelve solo JSON con exactamente dos claves: resumen (texto español) y filas (array).",
 "Copia el array filas exactamente, con iguales nombres, números, NULL, claves y orden.",
 "No inventes datos, porcentajes ni divisas. Todos los importes monetarios son EUR, no USD.",
 "Si la muestra es parcial dilo. Si faltan filas no supongas cero. No niegues acceso a datos ya recibidos."
].join(" ");
async function mcp(method,params){
 const body={jsonrpc:"2.0",id:1,method,...(params?{params}:{})};
 const res=await fetch(mcpURL,{method:"POST",headers:{"content-type":"application/json","cache-control":"no-store"},
  body:JSON.stringify(body),signal:AbortSignal.timeout(120000)});
 const data=await res.json();
 if(!res.ok||data.error||data.result?.isError)throw Error(safe(data.error?.message||data.result?.content?.[0]?.text||"MCP HTTP "+res.status));
 return data.result?.structuredContent??data.result;
}
function equal(a,b){
 if(a===b)return true;
 if(typeof a==="number"&&typeof b==="number")return Number.isFinite(b)&&Math.abs(a-b)<0.01001;
 if(!a||!b||typeof a!=="object"||typeof b!=="object")return false;
 if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>equal(v,b[i]));
 return Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(k=>Object.hasOwn(b,k)&&equal(a[k],b[k]));
}
function judge(raw,expected){
 let result;try{result=JSON.parse(raw.trim())}catch{return {ok:false,why:"JSON inválido o incompleto"}}
 if(!result||typeof result.resumen!=="string"||!Array.isArray(result.filas)||Object.keys(result).sort().join(",")!=="filas,resumen")
  return {ok:false,why:"Respuesta fuera del contrato"};
 if(/(\$|USD|d[oó]lares?)/i.test(result.resumen))return {ok:false,why:"Moneda inventada"};
 if(expected.length&&/(no hay datos|no tengo acceso|no puedo proporcionar)/i.test(result.resumen))
  return {ok:false,why:"El texto niega datos verificados"};
 const ok=equal(expected,result.filas);
 return {ok,why:ok?"Cifras y filas fieles":"Las cifras o filas no coinciden con el MCP"};
}
async function ollama(model,messages,predict=nPredict,show=true){
 const start=performance.now();
 const r=await fetch(ollamaURL+"/api/chat",{method:"POST",headers:{"content-type":"application/json"},
  body:JSON.stringify({model,messages,stream:true,format:"json",think:false,keep_alive:"15m",
   options:{temperature:0,num_ctx:2048,num_predict:predict,num_thread:2}}),
  signal:AbortSignal.timeout(600000)});
 if(!r.ok)throw Error("Ollama HTTP "+r.status+" "+safe((await r.text()).slice(0,140)));
 if(!r.body)throw Error("Ollama no devuelve streaming");
 const reader=r.body.getReader(),decoder=new TextDecoder();
 let buffer="",content="",last={},first=null;
 function parse(line){
  if(!line.trim())return;
  const data=JSON.parse(line);
  if(data.error)throw Error(safe(data.error));
  const token=data.message?.content||"";
  if(token){
   if(first===null)first=performance.now();
   content+=token;if(show)process.stdout.write(token);
  }
  if(data.done)last=data;
 }
 try{
  while(true){
   const {done,value}=await reader.read();if(done)break;
   buffer+=decoder.decode(value,{stream:true});
   let i;while((i=buffer.indexOf("\n"))>=0){parse(buffer.slice(0,i));buffer=buffer.slice(i+1)}
  }
  buffer+=decoder.decode();if(buffer.trim())parse(buffer);
 }finally{reader.releaseLock()}
 if(show)process.stdout.write("\n");
 return {content,seconds:(performance.now()-start)/1000,first:first===null?null:(first-start)/1000,
  load:(last.load_duration||0)/1e9,tokens:last.eval_count??null,
  speed:last.eval_duration&&last.eval_count?last.eval_count/(last.eval_duration/1e9):null};
}
const csv=x=>'"'+String(x??"").replaceAll('"','""').replace(/[\r\n]/g," ")+'"';
async function main(){
 console.log("====== COMPARATIVA REAL FARMÉTRICA · 2 HILOS ======");
 console.log("Modelos: "+models.join(", ")+"; repeticiones: "+repeats);
 const listed=await mcp("tools/list");
 if(!listed.tools?.some(x=>x.name==="resolver_pregunta_temporal"))throw Error("MCP sin resolver_pregunta_temporal");
 const sources=[];
 for(const id of ids){
  const pregunta=cases[id-1],start=performance.now();
  console.log("\n=== MCP ORIGINAL · CASO "+id+" ===\n"+pregunta);
  let data=null,error=null;
  try{
   data=await mcp("tools/call",{name:"resolver_pregunta_temporal",arguments:{url:link,pregunta}});
   if(data.estado!=="ok"||!Array.isArray(data.filas))error=data.mensaje||"Datos MCP no evaluables";
  }catch(e){error=safe(e.message)}
  const seconds=(performance.now()-start)/1000;
  const rows=!error?data.filas.slice(0,maxRows).map(row=>Object.fromEntries(columns.filter(k=>Object.hasOwn(row,k)).map(k=>[k,row[k]]))):[];
  const material=!error?{pregunta,fuente:data.consulta?.fuente||data.comparacion?.actual?.fuente||data.fuente||null,
   periodo:data.periodo||null,comparacion:data.comparacion||null,
   muestra_parcial:data.filas.length>rows.length,filas:rows}:null;
  console.log(error?"MCP NO EVALUABLE: "+error:"MCP OK: "+data.filas.length+" filas, "+round(seconds)+" s; "+rows.length+" enviadas al modelo");
  sources.push({id,pregunta,seconds,error,material});
 }
 let installed=new Set();
 try{const r=await fetch(ollamaURL+"/api/tags");if(r.ok)installed=new Set(((await r.json()).models||[]).map(m=>m.name))}catch{}
 const results=[];
 for(const model of models){
  console.log("\n================ "+model+" ================");
  if(installed.size&&!installed.has(model)){console.log("NO INSTALADO. ollama pull "+model);continue}
  console.log("Calentamiento: no se contabiliza.");
  try{await ollama(model,[{role:"user",content:"Devuelve {\"resumen\":\"ok\",\"filas\":[]}"}],100,false)}
  catch(e){console.log("Calentamiento fallido: "+safe(e.message))}
  for(const source of sources){
   if(source.error){console.log("CASO "+source.id+" omitido por error del MCP");continue}
   for(let rep=1;rep<=repeats;rep++){
    console.log("\nCASO "+source.id+", intento "+rep+", MCP "+round(source.seconds)+" s");
    console.log(source.pregunta);
    process.stdout.write("Respuesta STREAM: ");
    try{
     const r=await ollama(model,[{role:"system",content:system},
      {role:"user",content:JSON.stringify(source.material)}]);
     const score=judge(r.content,source.material.filas);
     results.push({model,caso:source.id,rep,mcp_s:source.seconds,modelo_s:r.seconds,
      primer_token_s:r.first,carga_s:r.load,tokens:r.tokens,tokens_s:r.speed,
      fiel:score.ok,nota:score.why});
     console.log("FIDELIDAD: "+(score.ok?"SÍ":"NO")+" · "+score.why);
     console.log("TIEMPOS: modelo "+round(r.seconds)+" s; primer token "+
      (r.first===null?"—":round(r.first)+" s")+"; carga "+round(r.load)+" s; "+(r.speed?round(r.speed):"—")+" tokens/s");
    }catch(e){
     const why=safe(e.message);console.log("\nERROR: "+why);
     results.push({model,caso:source.id,rep,mcp_s:source.seconds,modelo_s:null,
      primer_token_s:null,carga_s:null,tokens:null,tokens_s:null,fiel:false,nota:why});
    }
   }
  }
 }
 console.log("\n================ RESUMEN COMPARATIVO ================");
 for(const model of models){
  const rows=results.filter(r=>r.model===model),finished=rows.filter(r=>r.modelo_s!==null);
  const avg=k=>finished.length?round(finished.reduce((a,r)=>a+(r[k]||0),0)/finished.length):"—";
  console.log(model+": fiel "+rows.filter(r=>r.fiel).length+"/"+rows.length+
   " · modelo "+avg("modelo_s")+" s · primer token "+avg("primer_token_s")+" s · "+
   avg("tokens_s")+" tokens/s");
 }
 console.log("NOTA: Fidelidad = coincidencia de las filas estructuradas. Revisa también la calidad del texto.");
 console.log("NOTA: El tiempo MCP es común y los fallos MCP no penalizan al modelo.");
 console.log("CSV_START");
 const keys=["model","caso","rep","mcp_s","modelo_s","primer_token_s","carga_s","tokens","tokens_s","fiel","nota"];
 console.log(keys.join(","));
 for(const row of results)console.log(keys.map(k=>csv(row[k])).join(","));
 console.log("CSV_END");
}
main().catch(e=>{console.error("ERROR: "+safe(e.message));process.exitCode=1});
