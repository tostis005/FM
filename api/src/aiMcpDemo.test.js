import test from "node:test";
import assert from "node:assert/strict";
import {handlePublicDemoMcp,setupPublicDemoMcp} from "./aiMcpDemo.js";
const calls=[];
const pool={
 query:async(sql,args)=>{
  calls.push({sql,args});
  if(sql.includes("SELECT slug,nombre,esquema_datos"))return {rows:[{slug:"farmacias_demo",nombre:"Grupo Demo",esquema_datos:"farmacias_demo"}]};
  if(sql.includes("SELECT id,nombre AS name"))return {rows:[{id:101,name:"Farmacia 1",city:""},{id:102,name:"Farmacia 2",city:""}]};
  return {rows:[]};
 },
 connect:async()=>({
  query:async(sql,args)=>{
   calls.push({sql,args});
   if(sql.startsWith("SELECT f.nombre"))return {rows:[{farmacia:"Farmacia 1",importe:1234.56,unidades:15}]};
   if(sql.startsWith("SELECT b.farmacia_id"))return {rows:[{farmaciaId:101,farmacia:"Farmacia 1",importe:1234.56}]};
   return {rows:[]};
  },
  release:()=>calls.push({sql:"released"})
 })
};
const call=(method,params={},id=1)=>handlePublicDemoMcp({jsonrpc:"2.0",id,method,params},pool,"farmacias_demo");
test("MCP demo expone catálogo y consulta semántica con protocolo correcto",async()=>{
 assert.equal((await call("initialize")).body.result.serverInfo.name,"Farmetrica Demo Real");
 const tools=(await call("tools/list")).body.result.tools;
 assert.equal(tools.length,7);
  assert.ok(tools.some(t=>t.name==="resolver_pregunta"));
 assert.ok(tools.some(t=>t.name==="catalogo_semantico"));
 assert.ok(tools.some(t=>t.name==="consultar_semantica"));
 assert.ok(tools.every(t=>t.annotations.readOnlyHint===true));
 assert.equal((await call("notifications/initialized")).http,202);
});
test("contexto demo carga el cliente y las farmacias reales de PostgreSQL",async()=>{
 const r=(await call("tools/call",{name:"listar_contexto"})).body.result.structuredContent;
 assert.equal(r.ficticio,false);
 assert.equal(r.farmacias[0].id,101);
 assert.equal(r.cliente,"Grupo Demo");
 assert.ok(calls.some(c=>c.sql.includes("farmetrica.clientes")));
});
test("consultas analíticas reales reutilizan transacción READ ONLY y filtros del tenant",async()=>{
 const data=(await call("tools/call",{name:"consultar_indicador",arguments:{
  indicador:"ventas_resumen",desde:"2026-10-01",hasta:"2026-10-22",farmacias:[101]
 }})).body.result.structuredContent;
 assert.equal(data.available,true);
 assert.equal(data.ficticio,false);
 assert.equal(data.rows[0].importe,1234.56);
 assert.ok(calls.some(c=>c.sql==="BEGIN TRANSACTION READ ONLY"));
 assert.ok(calls.some(c=>c.sql==="ROLLBACK"));
 assert.ok(calls.some(c=>c.args?.[3]==="farmacias_demo"));
});
test("el MCP OAuth interpreta preguntas con reglas de Farmétrica, nunca con un modelo",async()=>{
 const result=await call("tools/call",{name:"resolver_pregunta",arguments:{
  pregunta:"¿Cuánto vendió cada farmacia el 22 de octubre de 2026?"
 }});
 assert.equal(result.body.result.structuredContent.estado,"ok");
 assert.equal(result.body.result.structuredContent.consulta.fuente,"ventas");
 assert.deepEqual(result.body.result.structuredContent.consulta.agrupar,["farmacia"]);
 assert.equal(result.body.result.structuredContent.origen,"PostgreSQL");
 const analyticsBefore=calls.filter(c=>c.sql==="BEGIN TRANSACTION READ ONLY").length;
 const unclear=await call("tools/call",{name:"resolver_pregunta",arguments:{
  pregunta:"Ventas por farmacia"
 }});
 assert.equal(unclear.body.result.structuredContent.estado,"aclaracion");
 assert.equal(unclear.body.result.structuredContent.filas,undefined);
 assert.equal(calls.filter(c=>c.sql==="BEGIN TRANSACTION READ ONLY").length,
  analyticsBefore,"una pregunta ambigua no debe ejecutar SQL analítico");
});
test("el MCP OAuth calcula diferencias canónicas sin alucinar importes",async()=>{
 const r=await call("tools/call",{name:"resolver_pregunta",arguments:{
  pregunta:"Compara las ventas por farmacia este mes respecto al mes pasado"
 }});
 const data=r.body.result.structuredContent;
 assert.equal(data.estado,"comparacion");
 assert.equal(data.origen,"PostgreSQL");
 assert.equal(data.filas[0].farmaciaId,101);
 assert.equal(data.filas[0].diferencia,0);
 assert.match(data.respuesta,/1.234,56 €/);
});
test("MCP demo permite consultas libres componiendo métricas y dimensiones sin SQL",async()=>{
 const context=(await call("tools/call",{name:"catalogo_semantico",arguments:{}})).body.result.structuredContent;
 assert.equal(context.catalogo.version,1);
 assert.ok(context.catalogo.fuentes.ventas.dimensiones.includes("vendedor"));
 const query=await call("tools/call",{name:"consultar_semantica",arguments:{
  fuente:"ventas",agrupar:["farmacia","vendedor"],
  metricas:["importe","unidades"],periodo:"hoy",farmacias:[101],limite:20
 }});
 const data=query.body.result.structuredContent;
 assert.equal(data.origen,"PostgreSQL");
 assert.equal(data.ficticio,false);
 assert.equal(data.fuente,"ventas");
 assert.ok(calls.some(c=>c.sql==="BEGIN TRANSACTION READ ONLY"));
 const denied=await call("tools/call",{name:"consultar_semantica",arguments:{
  fuente:"ventas",agrupar:["farmacia"],metricas:["importe"],farmacias:[999]
 }});
 assert.equal(denied.body.result.isError,true);
 const sql=await call("tools/call",{name:"consultar_semantica",arguments:{
  fuente:"ventas",metricas:["importe"],sql:"SELECT * FROM clientes"
 }});
 assert.equal(sql.body.result.isError,true);
});

test("se rechazan SQL libre, farmacias ajenas y fechas inexistentes",async()=>{
 for(const args of [
  {indicador:"DROP TABLE clientes"},
  {indicador:"ventas_resumen",sql:"SELECT * FROM secretos"},
  {indicador:"ventas_resumen",farmacias:[999]},
  {indicador:"ventas_resumen",desde:"2026-02-30",hasta:"2026-03-01"}
 ])assert.equal((await call("tools/call",{name:"consultar_indicador",arguments:args})).body.result.isError,true);
});
test("el endpoint solo utiliza el tenant OAuth autorizado y nunca consulta sin iniciar sesión",async()=>{
 const route=[];
 const app={
  post:(path,...handlers)=>route.push({method:"POST",path,handlers}),
  get:(path,...handlers)=>route.push({method:"GET",path,handlers}),
  delete:(path,...handlers)=>route.push({method:"DELETE",path,handlers})
 };
 const context={
  client:{slug:"farmacias_demo",name:"Grupo Demo",schema:"farmacias_demo"},
  role:"administrador",modules:{ventas:true,compras:true,stock:true},
  pharmacies:[{id:101,name:"Farmacia 1",city:""}],allowedPharmacyIds:[101]
 };
 const authenticate=(req,res,next)=>{
  if(req.get("authorization")!=="Bearer oauth-confirmado")
    return res.status(401).json({error:"Autenticación requerida"});
  req.context=context;req.aiConnection={id:777};return next();
 };
 setupPublicDemoMcp(app,pool,{authenticateOAuthDemo:authenticate});
 const handlers=route.find(x=>x.method==="POST"&&x.path==="/api/mcp-demo").handlers;
 assert.equal(handlers.length,2);
 let status=200,body;
 const res={status(n){status=n;return this},set(){return this},
  json(x){body=x;return this},end(){return this}};
 const makeReq=auth=>({get:key=>key==="authorization"?auth:"",body:{
  jsonrpc:"2.0",id:1,method:"tools/call",params:{name:"listar_contexto",arguments:{}}}});
 const before=calls.length;
 handlers[0](makeReq(""),res,()=>{throw Error("Debe bloquear sin OAuth")});
 assert.equal(status,401);
 assert.equal(calls.length,before);
 const req=makeReq("Bearer oauth-confirmado");
 await new Promise((resolve,reject)=>{
  handlers[0](req,res,err=>{
   if(err)return reject(err);
   handlers[1](req,res,e=>e?reject(e):resolve());
   // La respuesta es síncrona en el mock: async handler termina tras devolver JSON.
  });
  const check=setInterval(()=>{
   if(body?.result?.structuredContent?.cliente==="Grupo Demo"){
    clearInterval(check);resolve();
   }
  },1);
  setTimeout(()=>{clearInterval(check);reject(Error("La respuesta OAuth no llegó"))},2000);
 });
 assert.equal(status,200);
 assert.equal(body.result.structuredContent.ficticio,false);
 assert.equal(body.result.structuredContent.farmacias[0].id,101);
 assert.equal(route.filter(x=>x.path==="/api/mcp-demo").length,3);
});
