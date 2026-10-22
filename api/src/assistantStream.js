// Streaming de Ollama y eventos SSE. No se envían tokens de razonamiento.
export async function collectOllamaStream(stream,onDelta=()=>{},maxChars=4200){
 if(!stream||typeof stream.getReader!=="function")throw Error("Ollama no devuelve streaming");
 const reader=stream.getReader(),decoder=new TextDecoder();
 let buffer="",answer="",done=false;
 const consume=line=>{
  if(!line.trim())return;
  const obj=JSON.parse(line);
  if(obj.error)throw Error("Modelo no disponible durante la generación");
  const part=obj.message?.content;
  if(typeof part==="string"&&part&&!done){
   const remaining=maxChars-answer.length;
   if(remaining>0){
    const piece=part.slice(0,remaining);
    answer+=piece;
    onDelta(piece);
   }
  }
  if(obj.done===true)done=true;
 };
 try{
  for(;;){
   const result=await reader.read();
   if(result.done)break;
   buffer+=decoder.decode(result.value,{stream:true});
   if(buffer.length>1_000_000)throw Error("Respuesta de Ollama demasiado extensa");
   let split;
   while((split=buffer.indexOf("\n"))!==-1){
    const line=buffer.slice(0,split).replace(/\r$/,"");
    buffer=buffer.slice(split+1);
    consume(line);
   }
  }
  buffer+=decoder.decode();
  if(buffer.trim())consume(buffer);
  if(!done)throw Error("Ollama ha interrumpido la generación");
  if(!answer.trim())throw Error("El modelo no ha devuelto ninguna respuesta");
  return answer.trim();
 }finally{
  try{reader.releaseLock();}catch{}
 }
}

export function writeAssistantEvent(res,type,payload){
 if(!["progress","delta","done","error"].includes(type))throw Error("Evento no válido");
 if(res.destroyed||res.writableEnded)return false;
 res.write("event: "+type+"\n"+"data: "+JSON.stringify(payload)+"\n\n");
 return true;
}
