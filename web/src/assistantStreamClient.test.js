import test from "node:test";
import assert from "node:assert/strict";
import {readAssistantEvents} from "./assistantStreamClient.js";

function mockResponse(data,size=4){
 const bytes=new TextEncoder().encode(data);
 return {ok:true,body:new ReadableStream({start(controller){
  for(let i=0;i<bytes.length;i+=size)controller.enqueue(bytes.slice(i,i+size));
  controller.close();
 }})};
}
const event=(type,payload)=>"event: "+type+"\ndata: "+JSON.stringify(payload)+"\n\n";

test("el cliente muestra fases, tokens Unicode y fin de respuesta",async()=>{
 const chunks=[
  event("progress",{stage:"planning",label:"Preparando…"}),
  ": ping\n\n",
  event("delta",{text:"¡Hola, "}),
  event("delta",{text:"farmacias!"}),
  event("done",{answer:"¡Hola, farmacias!",sources:[]})
 ].join("");
 const events=[];
 await readAssistantEvents(mockResponse(chunks,2),(type,payload)=>events.push([type,payload]));
 assert.deepEqual(events.map(([type])=>type),["progress","delta","delta","done"]);
 assert.equal(events.at(-1)[1].answer,"¡Hola, farmacias!");
});

test("el cliente detecta interrupciones sin evento done",async()=>{
 await assert.rejects(readAssistantEvents(mockResponse(event("delta",{text:"a"})),()=>{}),/antes de terminar/);
});

test("el cliente muestra errores del backend",async()=>{
 await assert.rejects(readAssistantEvents(mockResponse(event("error",{error:"Consulta fallida"})),()=>{}),/Consulta fallida/);
});
