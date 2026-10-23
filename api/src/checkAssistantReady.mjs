// Comprobación interna del piloto IA tras el despliegue.
// Se ejecuta DENTRO del contenedor de API. Sin credenciales, sin consultas a DB,
// sin publicar Ollama en el host ni depender de sesiones de usuario.
const expected="qwen3:0.6b";
const url=String(process.env.AI_OLLAMA_URL||"http://ollama:11434").replace(/\/+$/,"");
async function verify(){
 if(process.env.AI_ENABLED!=="true")throw Error("AI_ENABLED no está activado");
 if(process.env.AI_MODEL!==expected)throw Error("El modelo configurado no es "+expected);
 const tags=await fetch(url+"/api/tags",{signal:AbortSignal.timeout(15000)});
 if(!tags.ok)throw Error("Ollama no responde al catálogo (HTTP "+tags.status+")");
 const models=(await tags.json()).models||[];
 if(!models.some(m=>m.name===expected||m.model===expected))
  throw Error("Qwen3 0.6B no está descargado en Ollama; instalar: ollama pull "+expected);
 const started=performance.now();
 const test=await fetch(url+"/api/chat",{
  method:"POST",
  headers:{"Content-Type":"application/json"},
  body:JSON.stringify({model:expected,stream:false,think:false,
   messages:[{role:"user",content:"Responde únicamente OK."}],
   options:{temperature:0,num_ctx:1024,num_predict:24,num_thread:2},
   keep_alive:"2m"}),
  signal:AbortSignal.timeout(120000)
 });
 if(!test.ok)throw Error("Ollama no acepta una inferencia con Qwen3 0.6B (HTTP "+test.status+")");
 const reply=await test.json();
 if(typeof reply?.message?.content!=="string"||!reply.message.content.trim())
  throw Error("Qwen3 0.6B respondió sin texto");
 console.log("Asistente Farmétrica: ACTIVADO · "+expected+
  " · Ollama accesible · inferencia correcta · "+
  Math.round(performance.now()-started)+" ms");
}
verify().catch(error=>{
 console.error("FALLO comprobación de asistente:",error.message);
 process.exitCode=1;
});
