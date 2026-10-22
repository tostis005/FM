// Lector de eventos SSE sobre POST autenticado; soporta fragmentos arbitrarios.
export async function readAssistantEvents(response,onEvent){
 if(!response.ok){
  const body=await response.json().catch(()=>({}));
  throw Error(body.error||"No se pudo iniciar la consulta");
 }
 if(!response.body?.getReader)throw Error("Este navegador no admite respuestas en streaming");
 const reader=response.body.getReader(),decoder=new TextDecoder();
 let buffer="",completed=false;
 const consume=frame=>{
  if(!frame.trim()||frame.startsWith(":"))return;
  const lines=frame.split("\n");
  const eventLine=lines.find(line=>line.startsWith("event:"));
  const dataLine=lines.find(line=>line.startsWith("data:"));
  if(!eventLine||!dataLine)return;
  const type=eventLine.slice(6).trim();
  const payload=JSON.parse(dataLine.slice(5).trim());
  if(type==="error")throw Error(payload.error||"No se pudo completar la consulta");
  if(!["progress","delta","done"].includes(type))return;
  onEvent(type,payload);
  if(type==="done")completed=true;
 };
 try{
  for(;;){
   const chunk=await reader.read();
   if(chunk.done)break;
   buffer+=decoder.decode(chunk.value,{stream:true}).replace(/\r\n/g,"\n");
   if(buffer.length>1_000_000)throw Error("Respuesta demasiado extensa");
   let pos;
   while((pos=buffer.indexOf("\n\n"))!==-1){
    consume(buffer.slice(0,pos));
    buffer=buffer.slice(pos+2);
   }
  }
  buffer+=decoder.decode();
  if(buffer.trim())consume(buffer);
  if(!completed)throw Error("La conexión se cerró antes de terminar la respuesta");
 }finally{
  reader.releaseLock();
 }
}
