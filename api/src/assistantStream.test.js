import test from "node:test";
import assert from "node:assert/strict";
import {collectOllamaStream,writeAssistantEvent} from "./assistantStream.js";

function splitStream(text,size=3){
 const bytes=new TextEncoder().encode(text);
 return new ReadableStream({start(controller){
  for(let i=0;i<bytes.length;i+=size)controller.enqueue(bytes.slice(i,i+size));
  controller.close();
 }});
}

test("Ollama entrega tokens aunque lleguen fragmentados en mitad de UTF-8",async()=>{
 const payload=[
  JSON.stringify({message:{content:"¡Ho"},done:false}),
  JSON.stringify({message:{content:"la!"},done:false}),
  JSON.stringify({done:true})
 ].join("\n")+"\n";
 const deltas=[];
 const result=await collectOllamaStream(splitStream(payload,2),delta=>deltas.push(delta));
 assert.equal(result,"¡Hola!");
 assert.deepEqual(deltas,["¡Ho","la!"]);
});

test("un flujo incompleto no se presenta como respuesta final",async()=>{
 await assert.rejects(
  collectOllamaStream(splitStream(JSON.stringify({message:{content:"Parcial"},done:false})+"\n")),
  /interrumpido/
 );
});

test("SSE envía un evento del estado y su JSON en líneas separadas",()=>{
 const chunks=[];
 const res={destroyed:false,writableEnded:false,write:value=>chunks.push(value)};
 assert.equal(writeAssistantEvent(res,"progress",{stage:"planning",label:"Analizando"}),true);
 const body=chunks.join("");
 assert.ok(body.startsWith("event: progress\ndata: "));
 assert.ok(body.endsWith("\n\n"));
 assert.deepEqual(JSON.parse(body.split("\n")[1].slice(6)),{stage:"planning",label:"Analizando"});
 assert.throws(()=>writeAssistantEvent(res,"custom",{}),/no válido/);
});
