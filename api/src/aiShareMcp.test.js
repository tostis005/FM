import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {setupShareMcp,parseShareUrl,SHARE_MCP_TOOLS} from "./aiShareMcp.js";

const token="fm_share_"+"a".repeat(43);
const url="https://farmetrica.com/api/consulta-temporal/"+token;
const path="/api/consulta-temporal/mcp";
const rpc=(id,method,params)=>({jsonrpc:"2.0",id,method,...(params?{params}:{})});
test("MCP sin OAuth no expone datos ni tokens hasta recibir la URL vigente",async()=>{
 const queries=[];
 let live=true;
 const pool={
  query:async(sql,params=[])=>{
   queries.push({sql,params});
   if(sql.includes("SELECT slug,nombre,esquema_datos FROM farmetrica.clientes"))
    return {rows:[{slug:"grupo_demo",nombre:"Grupo real",esquema_datos:"grupo_demo"}]};
   if(sql.includes("SELECT id,nombre AS name,ciudad AS city"))
    return {rows:[{id:101,name:"Farmacia Real Uno",city:"Madrid"}]};
   if(sql.includes("information_schema.columns"))return {rows:[]};
   throw Error("unexpected query "+sql);
  },
  connect:async()=>({query:async(sql,params=[])=>{
   queries.push({sql,params});
   if(sql.startsWith("SELECT"))return {rows:[{farmacia:"Farmacia Real Uno",importe:221.14}]};
   return {rows:[]};
  },release:()=>{}})
 };
 const app=express();app.use(express.json());
 setupShareMcp(app,pool,{resolveLink:async t=>live&&t===token?"grupo_demo":null});
 const server=await new Promise(resolve=>{const s=app.listen(0,"127.0.0.1",()=>resolve(s))});
 const base="http://127.0.0.1:"+server.address().port;
 const post=async data=>fetch(base+path,{method:"POST",headers:{"Content-Type":"application/json"},
  body:JSON.stringify(data)});
 try{
  const init=await (await post(rpc(1,"initialize",{}))).json();
  assert.equal(init.result.serverInfo.name,"Farmetrica Temporary Link");
  const list=await (await post(rpc(2,"tools/list"))).json();
  assert.equal(list.result.tools.length,3);
  assert.equal(SHARE_MCP_TOOLS.length,3);
  assert.ok(list.result.tools.some(t=>t.name==="consultar_datos_temporales"));
  assert.equal(queries.length,0,"Listing unauthenticated tools must not touch the DB");
  const bad=await (await post(rpc(3,"tools/call",{name:"leer_modelo_temporal",
   arguments:{url:"https://evil.example/"+token}}))).json();
  assert.equal(bad.result.isError,true);
  assert.equal(queries.length,0);
  const model=await (await post(rpc(4,"tools/call",{name:"leer_modelo_temporal",
   arguments:{url}}))).json();
  assert.equal(model.result.structuredContent.contrato,"farmetrica.analytics.readonly.v1");
  assert.equal(model.result.structuredContent.farmacias[0].nombre,"Farmacia Real Uno");
  const query=await (await post(rpc(5,"tools/call",{name:"consultar_datos_temporales",
   arguments:{url,consulta:{fuente:"ventas",agrupar:["farmacia"],metricas:["importe"],
    periodo:"hoy",farmacias:[101],limite:10}}}))).json();
  assert.equal(query.result.structuredContent.filas[0].importe,221.14);
  assert.equal(query.result.structuredContent.origen,"PostgreSQL");
  assert.ok(queries.some(q=>q.sql.includes("BEGIN TRANSACTION READ ONLY")));
  assert.ok(queries.some(q=>q.sql.includes("fm_ventas_analitica")));
  const resolved=await (await post(rpc(50,"tools/call",{name:"resolver_pregunta_temporal",
    arguments:{url,pregunta:"¿Cuánto vendió cada farmacia el 22 de octubre de 2026?"}}))).json();
   assert.equal(resolved.result.structuredContent.estado,"ok");
   assert.deepEqual(resolved.result.structuredContent.columnas,["Farmacia","Ventas"]);
   assert.deepEqual(resolved.result.structuredContent.filas[0],
    {Farmacia:"Farmacia Real Uno",Ventas:"221,14 €"});
   assert.equal(resolved.result.structuredContent.consulta,undefined);
   assert.match(resolved.result.content[0].text,/\\| Farmacia \\| Ventas \\|/);
   assert.doesNotMatch(JSON.stringify(resolved.result),/farmaciaId|vendedorNombre|estado":"completo/);
   const ambiguous=await (await post(rpc(51,"tools/call",{name:"resolver_pregunta_temporal",
    arguments:{url,pregunta:"¿Cuánto vendió cada farmacia?"}}))).json();
   assert.equal(ambiguous.result.structuredContent.estado,"aclaracion");
   assert.equal(ambiguous.result.structuredContent.filas,undefined);
   const invalidUrl=await (await post(rpc(52,"tools/call",{name:"resolver_pregunta_temporal",
    arguments:{url:"https://evil.example/",pregunta:"Ventas de hoy"}}))).json();
   assert.equal(invalidUrl.result.isError,true);
   const injection=await (await post(rpc(6,"tools/call",{name:"consultar_datos_temporales",
   arguments:{url,consulta:{fuente:"ventas",metricas:["importe"],sql:"DELETE FROM clientes"}}}))).json();
  assert.equal(injection.result.isError,true);
  const denied=await (await post(rpc(7,"tools/call",{name:"consultar_datos_temporales",
   arguments:{url,consulta:{fuente:"ventas",metricas:["importe"],farmacias:[999]}}}))).json();
  assert.equal(denied.result.isError,true);
  live=false;
  const expired=await (await post(rpc(8,"tools/call",{name:"leer_modelo_temporal",
   arguments:{url}}))).json();
  assert.equal(expired.result.isError,true);
  assert.equal((await fetch(base+path)).status,405);
 }finally{await new Promise(resolve=>server.close(resolve))}
});
test("Sólo acepta enlaces HTTPS del propio dominio",()=>{
 assert.equal(parseShareUrl(url),token);
 for(const value of [
  "http://farmetrica.com/api/consulta-temporal/"+token,
  "https://farmetrica.com.evil.org/api/consulta-temporal/"+token,
  url+"?formato=json",url+"/AGENTS.md",token,
  "https://farmetrica.com/api/consulta-temporal/fm_share_invalid"
 ])assert.throws(()=>parseShareUrl(value));
});
