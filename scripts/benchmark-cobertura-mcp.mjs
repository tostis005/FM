#!/usr/bin/env node
// Farmétrica: comparar resúmenes cortos con una ÚNICA consulta MCP por pregunta.
// La tabla la genera Farmétrica, nunca el modelo. No se transmite el enlace secreto.
const E=process.env;
const LINK=E.FM_TEMP_LINK||"";
const MCP=E.FM_MCP_URL||"http://127.0.0.1:8000/api/consulta-temporal/mcp";
const OLLAMA=E.FM_OLLAMA_URL||"http://ollama:11434";
const MODELS=(E.FM_MODELS||"qwen3:0.6b,qwen3:1.7b,llama3.2:1b,gemma3:1b")
 .split(",").map(x=>x.trim()).filter(Boolean);
// Clasificación explícita: una pregunta sin respuesta no debe penalizar a la IA.
// "rapido" cubre todas las familias; "completo" amplía variantes y consultas costosas.
// Las fechas son históricas y fijas para que la comparación sea reproducible.
const CASES=[
 {id:1,grupo:"ventas",pregunta:"¿Cuánto vendió cada farmacia el 22 de octubre de 2026?",columnas:["Farmacia","Ventas"],rapido:true},
 {id:2,grupo:"ventas",pregunta:"Top 10 vendedores con más ventas este mes",columnas:["Farmacia","Vendedor","Ventas"],rapido:true},
 {id:3,grupo:"ventas",pregunta:"Ventas por fecha de los últimos 7 días",columnas:["Día","Ventas"],rapido:true},
 {id:4,grupo:"ventas",pregunta:"Ventas por vendedor y por fecha de los últimos 7 días",columnas:["Farmacia","Vendedor","Día","Ventas"]},
 {id:5,grupo:"ventas",pregunta:"Ventas por farmacia en octubre de 2026",columnas:["Farmacia","Ventas"]},
 {id:6,grupo:"ventas",pregunta:"Top 10 vendedores con más ventas este año",columnas:["Farmacia","Vendedor","Ventas"]},
 {id:7,grupo:"ventas",pregunta:"Top 10 productos más vendidos este mes",columnas:["Producto","Unidades"]},
 {id:8,grupo:"ventas",pregunta:"¿Cuántas unidades vendidas por producto ayer?",columnas:["Producto","Unidades"]},
 {id:9,grupo:"productos",pregunta:"¿Cuánto vendimos de solares el año pasado?",columnas:["Ventas"],rapido:true},
 {id:10,grupo:"productos",pregunta:"Ventas de cremas solares este mes",columnas:["Ventas"]},
 {id:11,grupo:"productos",pregunta:"Top 10 productos solares más vendidos este año",columnas:["Producto","Unidades"]},
 {id:12,grupo:"compras",pregunta:"Compras por farmacia este mes",columnas:["Farmacia","Compras"],rapido:true},
 {id:13,grupo:"compras",pregunta:"¿Cuánto compramos a cada proveedor entre el 1 y el 22 de octubre de 2026?",columnas:["Farmacia","Proveedor","Compras"],rapido:true},
 {id:14,grupo:"compras",pregunta:"Top 10 proveedores con más compras este mes",columnas:["Farmacia","Proveedor","Compras"],rapido:true},
 {id:15,grupo:"compras",pregunta:"¿Cuánto hemos gastado en el proveedor Cofares este mes?",columnas:["Compras"]},
 {id:16,grupo:"compras",pregunta:"Compras por día de los últimos 30 días",columnas:["Día","Compras"]},
 {id:17,grupo:"compras",pregunta:"Unidades compradas por proveedor este mes",columnas:["Farmacia","Proveedor","Unidades"]},
 {id:18,grupo:"compras",pregunta:"Compras por proveedor de los últimos 45 días",columnas:["Farmacia","Proveedor","Compras"]},
 {id:19,grupo:"margenes",pregunta:"¿Cuál es el margen estimado de ventas por farmacia este mes?",columnas:["Farmacia","Margen estimado"],rapido:true},
 {id:20,grupo:"margenes",pregunta:"¿Cuál es el porcentaje de margen estimado de ventas por farmacia este mes?",columnas:["Farmacia","Margen estimado (%)"],rapido:true},
 {id:21,grupo:"stock",pregunta:"¿Cuánto stock tenemos por farmacia?",columnas:["Farmacia","Stock actual"],rapido:true},
 {id:22,grupo:"stock",pregunta:"¿Cuánto capital estimado de stock tenemos por farmacia?",columnas:["Farmacia","Capital estimado"]},
 {id:23,grupo:"stock",pregunta:"Stock por producto y farmacia",columnas:["Farmacia","Producto","Stock actual"]},
 {id:24,grupo:"comparaciones",pregunta:"Compara ventas por farmacia este mes respecto al mes pasado",columnas:["Farmacia","Anterior","Actual","Diferencia","Variación"],rapido:true},
 {id:25,grupo:"comparaciones",pregunta:"Compara las ventas por farmacia del 1 al 15 de octubre de 2026 con las del 1 al 15 de septiembre de 2026",columnas:["Farmacia","Anterior","Actual","Diferencia","Variación"]},
 {id:26,grupo:"periodos",pregunta:"Ventas por farmacia desde el 1 de enero de 2026 hasta hoy",columnas:["Farmacia","Ventas"],rapido:true},
 {id:27,grupo:"periodos",pregunta:"Ventas por vendedor y por fecha de los últimos 45 días",columnas:["Farmacia","Vendedor","Día","Ventas"]},
 {id:28,grupo:"periodos",pregunta:"Ventas por farmacia por mes este año",columnas:["Farmacia","Mes","Ventas"]},
 {id:29,grupo:"limites",pregunta:"¿Cuánto beneficio neto obtuvimos este mes?",estado:"no_disponible",rapido:true},
 {id:30,grupo:"limites",pregunta:"¿Cuál era el stock el 22 de octubre de 2026?",estado:"no_disponible"},
 {id:31,grupo:"limites",pregunta:"Ventas por farmacia",estado:"aclaracion",rapido:true},
 {id:32,grupo:"limites",pregunta:"Ventas y compras por farmacia hoy",estado:"aclaracion",rapido:true}
];
const PROFILE=(E.FM_PROFILE||"rapido").trim();
const selected=E.FM_CASES?.trim()?E.FM_CASES.split(",").map(Number):
 CASES.filter(x=>PROFILE==="completo"||x.rapido).map(x=>x.id);
const IDS=selected;
const REPS=Number(E.FM_REPS||1);
if(!/^https:\/\/farmetrica\.com\/api\/consulta-temporal\/fm_share_[\w-]{43}$/.test(LINK))
 throw Error("FM_TEMP_LINK requiere la URL temporal raíz vigente");
if(!MODELS.length||MODELS.length>8||MODELS.some(x=>!/^[\w.:-]{2,60}$/.test(x)))
 throw Error("FM_MODELS inválido");
if(!["rapido","completo"].includes(PROFILE))throw Error("FM_PROFILE debe ser rapido o completo");
if(!IDS.length||IDS.some(x=>!Number.isInteger(x)||!CASES.some(c=>c.id===x))||
 new Set(IDS).size!==IDS.length||!Number.isInteger(REPS)||REPS<1||REPS>4)
 throw Error("FM_CASES o FM_REPS fuera de rango");
const hide=s=>String(s).replaceAll(LINK,"[ENLACE OCULTO]").replaceAll(LINK.slice(-43),"[TOKEN OCULTO]");
const round=n=>Math.round(n*100)/100;
// La prueba usa EXACTAMENTE el prompt y el validador de producción.
// En /app (contenedor API) se ejecuta por STDIN; en repositorio, como archivo.
const {SHORT_SUMMARY_SYSTEM,shortSummaryContext,validateShortSummary}=
 await import("./src/semanticPresentation.js")
  .catch(()=>import("../api/src/semanticPresentation.js"));
async function mcpCall(method,params){
 const r=await fetch(MCP,{method:"POST",headers:{"Content-Type":"application/json",
  "Cache-Control":"no-store"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,...(params?{params}:{})}),
  signal:AbortSignal.timeout(120000)});
 let response;try{response=await r.json()}catch{throw Error("MCP no devolvió JSON")}
 if(!r.ok||response.error||response.result?.isError)
  throw Error(hide(response.error?.message||response.result?.content?.[0]?.text||"MCP HTTP "+r.status));
 return response.result;
}
async function generate(model,question,p,warm=false){
 const start=performance.now();
 const messages=warm?[{role:"user",content:"Responde OK"}]:[
  {role:"system",content:SHORT_SUMMARY_SYSTEM},
  {role:"user",content:"Pregunta: "+question+
   "\nEvidencia verificada: "+JSON.stringify(shortSummaryContext(p))+
   "\nRedacta solo uno o dos enunciados basados en los hechos, usando exclusivamente cifras y nombres verificados. Sin tabla."}
 ];
 const r=await fetch(OLLAMA+"/api/chat",{
  method:"POST",headers:{"Content-Type":"application/json"},
  body:JSON.stringify({model,stream:true,think:false,messages,keep_alive:"2m",
   options:{temperature:0.1,num_ctx:1024,num_predict:warm?25:90,num_thread:2}}),
  signal:AbortSignal.timeout(600000)
 });
 if(!r.ok)throw Error("Ollama HTTP "+r.status+": "+hide((await r.text()).slice(0,100)));
 if(!r.body)throw Error("Ollama sin streaming");
 const reader=r.body.getReader(),decoder=new TextDecoder();
 let buffer="",summary="",first=null,stats=null;
 function accept(line){
  if(!line.trim())return;
  const event=JSON.parse(line);
  if(event.error)throw Error(hide(event.error));
  const token=event.message?.content||"";
  if(token){
   if(first===null)first=performance.now();
   summary+=token;
   if(!warm)process.stdout.write(token);
  }
  if(event.done)stats=event;
 }
 try{
  while(true){
   const {done,value}=await reader.read();if(done)break;
   buffer+=decoder.decode(value,{stream:true});
   let index;while((index=buffer.indexOf("\n"))>=0){
    accept(buffer.slice(0,index));buffer=buffer.slice(index+1);
   }
  }
  buffer+=decoder.decode();if(buffer.trim())accept(buffer);
 }finally{reader.releaseLock()}
 if(!warm)process.stdout.write("\n");
 if(!stats)throw Error("Ollama interrumpió la generación");
 return {summary:summary.trim(),time:(performance.now()-start)/1000,
  first:first===null?null:(first-start)/1000,tokens:stats.eval_count||0,
  tps:stats.eval_duration&&stats.eval_count?stats.eval_count/(stats.eval_duration/1e9):null,
  load:stats.load_duration/1e9||0,reason:stats.done_reason||"desconocido"};
}
const csv=x=>'"'+String(x??"").replaceAll('"','""').replace(/[\r\n]/g," ")+'"';
async function main(){
 console.log("===== FARMÉTRICA · COBERTURA REAL MCP + COMPARATIVA DE MODELOS =====");
 console.log("Perfil: "+PROFILE+" | casos: "+IDS.length+" | modelos: "+MODELS.join(", "));
 console.log("Repeticiones: "+REPS+" | Ollama: 90 tokens, contexto 1024, 2 hilos");
 console.log("El MCP se consulta UNA vez por pregunta; todos los modelos reciben exactamente la misma evidencia.");
 const list=await mcpCall("tools/list");
 if(!list?.tools?.some(x=>x.name==="resolver_pregunta_temporal"))
  throw Error("El MCP no anuncia resolver_pregunta_temporal");
 const cases=[],mcpRecords=[];
 for(const id of IDS){
  const def=CASES.find(x=>x.id===id);
  const start=performance.now();
  console.log("\n--- MCP "+id+" · "+def.grupo.toUpperCase()+" ---\n"+def.pregunta);
  try{
   const m=await mcpCall("tools/call",{name:"resolver_pregunta_temporal",
    arguments:{url:LINK,pregunta:def.pregunta}});
   const data=m?.structuredContent;
   if(!data||typeof data.estado!=="string")
    throw Error("El MCP no ha devuelto un estado canónico");
   const time=(performance.now()-start)/1000,expected=def.estado||"ok";
   const cols=Array.isArray(data.columnas)?data.columnas:[];
   const missing=(def.columnas||[]).filter(c=>!cols.includes(c));
   const correct=data.estado===expected&&(!missing.length)&&
    (expected!=="ok"||(Array.isArray(data.filas)&&Array.isArray(data.columnas)));
   const rows=data.filas?.length??0;
   const unknownSupplier=data.estado==="ok"&&data.columnas?.includes("Proveedor")&&
    data.filas?.some(x=>x.Proveedor==="Proveedor no identificado");
   const warning=(data.advertencias||[]).filter(x=>
    /muestra|limite|l[ií]mite|parcial|familia|solar|proveedor/i.test(x)).slice(0,3);
   const status=correct?(expected!=="ok"?"RECHAZO_CORRECTO":
      !rows?"SIN_DATOS":"OK"):"FALLO_INTERPRETACION";
   console.log("Estado "+data.estado+" (esperado "+expected+") · "+status+
    " · "+round(time)+" s · "+rows+" filas");
   if(cols.length)console.log("Columnas: "+cols.join(" / "));
   if(missing.length)console.log("FALTAN DIMENSIONES O METRICAS: "+missing.join(", "));
   if(unknownSupplier)console.log("CALIDAD DATO: todavía hay proveedores no identificados");
   for(const w of warning)console.log("AVISO: "+w);
   if(data.estado!=="ok")console.log("MOTIVO: "+hide(data.mensaje||"sin detalles"));
   const record={id,grupo:def.grupo,pregunta:def.pregunta,
    esperado:expected,estado:data.estado,cobertura:status,mcp_s:time,
    filas:rows,columnas:cols.join("; "),faltantes:missing.join("; "),
    proveedor_no_identificado:Boolean(unknownSupplier),mensaje:data.mensaje||""};
   mcpRecords.push(record);
   cases.push({def,data,time,correct,hasRows:data.estado==="ok"&&rows>0});
  }catch(e){
   const error=hide(e.message);
   console.log("FALLO MCP: "+error);
   mcpRecords.push({id,grupo:def.grupo,pregunta:def.pregunta,
    esperado:def.estado||"ok",estado:"error",cobertura:"ERROR_MCP",
    mcp_s:(performance.now()-start)/1000,filas:0,mensaje:error});
   cases.push({def,error});
  }
 }
 let installed=null;
 try{const r=await fetch(OLLAMA+"/api/tags",{signal:AbortSignal.timeout(15000)});
  if(r.ok)installed=new Set(((await r.json()).models||[]).map(x=>x.name))}catch{}
 const records=[];
 for(const model of MODELS){
  console.log("\n================ MODELO: "+model+" ================");
  if(installed&&!installed.has(model)){
   console.log("NO INSTALADO EN OLLAMA; no se interpreta como suspenso");
   continue;
  }
  try{await generate(model,"",{},true);console.log("Calentamiento excluido")}
  catch(e){console.log("Aviso calentamiento: "+hide(e.message))}
  for(const c of cases){
   if(c.error||!c.correct||!c.hasRows){
    console.log("Omitido "+c.def.id+" (sin filas verificadas, rechazo correcto o fallo del MCP)");
    continue;
   }
   for(let rep=1;rep<=REPS;rep++){
    console.log("\nCASO "+c.def.id+" · "+c.def.grupo+" · intento "+rep+"/"+REPS+
     "\n"+c.def.pregunta+"\nRESUMEN STREAM:");
    try{
     const r=await generate(model,c.def.pregunta,c.data);
     const accepted=Boolean(validateShortSummary(r.summary,c.data))&&r.reason!=="length";
     const duration=r.time;
     console.log("RESULTADO: "+(accepted?"ACEPTADO POR VALIDADOR":"RECHAZADO; se usaría resumen oficial")+
      " | modelo "+round(duration)+" s | primer token "+
      (r.first===null?"—":round(r.first)+" s")+" | "+round(r.tps)+" tokens/s"+
      " | fin "+r.reason);
     records.push({modelo:model,caso:c.def.id,grupo:c.def.grupo,
      rep,mcp_s:c.time,modelo_s:duration,primer_token_s:r.first,
      tokens:r.tokens,tokens_s:r.tps,aceptado:accepted,
      finalizacion:r.reason,resumen:r.summary});
    }catch(e){
     const msg=hide(e.message);
     console.log("ERROR MODELO: "+msg);
     records.push({modelo:model,caso:c.def.id,grupo:c.def.grupo,
      rep,mcp_s:c.time,modelo_s:null,primer_token_s:null,
      aceptado:false,finalizacion:"error",resumen:msg});
    }
   }
  }
 }
 console.log("\n================ COBERTURA MCP =================");
 const stats={};
 for(const x of mcpRecords){
  stats[x.cobertura]=(stats[x.cobertura]||0)+1;
 }
 console.log(JSON.stringify(stats));
 for(const grupo of [...new Set(CASES.map(x=>x.grupo))]){
  const subset=mcpRecords.filter(x=>x.grupo===grupo);
  if(!subset.length)continue;
  const pass=subset.filter(x=>["OK","SIN_DATOS","RECHAZO_CORRECTO"].includes(x.cobertura)).length;
  console.log(grupo+": "+pass+"/"+subset.length+" consultas interpretadas correctamente");
 }
 console.log("\n================ COMPARATIVA IA =================");
 for(const model of MODELS){
  const samples=records.filter(x=>x.modelo===model);
  const available=samples.filter(x=>x.modelo_s!==null);
  const average=k=>available.length?round(available.reduce((v,x)=>v+(x[k]||0),0)/available.length):"—";
  console.log(model+": "+samples.filter(x=>x.aceptado).length+"/"+samples.length+
   " resúmenes aceptados; "+average("modelo_s")+" s media; "+
   average("primer_token_s")+" s hasta primer token; "+average("tokens_s")+" tok/s");
 }
 console.log("NOTAS: aceptación del validador NO prueba exactitud semántica completa.");
 console.log("SIN_DATOS no es un fallo del modelo ni demuestra que el origen tenga compras o ventas nulas.");
 console.log("Estos modelos se comparan como REDACTORES: la interpretación y SQL son comunes, del MCP.");
 const colsMcp=["id","grupo","pregunta","esperado","estado","cobertura","mcp_s",
  "filas","columnas","faltantes","proveedor_no_identificado","mensaje"];
 console.log("CSV_MCP_START\n"+colsMcp.join(","));
 for(const row of mcpRecords)console.log(colsMcp.map(k=>csv(row[k])).join(","));
 console.log("CSV_MCP_END");
 const colsModels=["modelo","caso","grupo","rep","mcp_s","modelo_s","primer_token_s",
  "tokens","tokens_s","aceptado","finalizacion","resumen"];
 console.log("CSV_MODELOS_START\n"+colsModels.join(","));
 for(const row of records)console.log(colsModels.map(k=>csv(row[k])).join(","));
 console.log("CSV_MODELOS_END");
}
main().catch(e=>{console.error("ERROR BENCHMARK: "+hide(e.message));process.exitCode=1});
