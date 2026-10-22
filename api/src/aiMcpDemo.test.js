import test from "node:test";
import assert from "node:assert/strict";
import {demoBearerMatches,generateDemoKey,handlePublicDemoMcp,setupPublicDemoMcp} from "./aiMcpDemo.js";
import {createHash} from "node:crypto";
const secret=generateDemoKey(),hash=createHash("sha256").update(secret).digest("hex");
const calls=[];
const pool={
 query:async(sql,args)=>{
  calls.push({sql,args});
  if(sql.includes("SELECT slug,nombre,esquema_datos"))return {rows:[{slug:"farmacias_demo",nombre:"Grupo Demo",esquema_datos:"farmacias_demo"}]};
  if(sql.includes("SELECT id,nombre AS name"))return {rows:[{id:101,name:"Farmacia 1",city:""},{id:102,name:"Farmacia 2",city:""}]};
  if(sql.includes("ai_mcp_demo_keys"))return {rows:[{secret_hash:hash,cliente_slug:"farmacias_demo"}]};
  return {rows:[]};
 },
 connect:async()=>({
  query:async(sql,args)=>{
   calls.push({sql,args});
   if(sql.startsWith("SELECT f.nombre"))return {rows:[{farmacia:"Farmacia 1",importe:1234.56,unidades:15}]};
   return {rows:[]};
  },
  release:()=>calls.push({sql:"released"})
 })
};
const call=(method,params={},id=1)=>handlePublicDemoMcp({jsonrpc:"2.0",id,method,params},pool,"farmacias_demo");
test("las claves son aleatorias, largas y verificadas como Bearer",()=>{
 assert.match(secret,/^fm_demo_[A-Za-z0-9_-]{43}$/);
 assert.equal(demoBearerMatches("Bearer "+secret,hash),true);
 assert.equal(demoBearerMatches("Bearer "+generateDemoKey(),hash),false);
 assert.equal(demoBearerMatches("",hash),false);
});
test("MCP demo mantiene las cuatro herramientas de lectura con protocolo correcto",async()=>{
 assert.equal((await call("initialize")).body.result.serverInfo.name,"Farmetrica Demo Real");
 const tools=(await call("tools/list")).body.result.tools;
 assert.equal(tools.length,4);
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
test("se rechazan SQL libre, farmacias ajenas y fechas inexistentes",async()=>{
 for(const args of [
  {indicador:"DROP TABLE clientes"},
  {indicador:"ventas_resumen",sql:"SELECT * FROM secretos"},
  {indicador:"ventas_resumen",farmacias:[999]},
  {indicador:"ventas_resumen",desde:"2026-02-30",hasta:"2026-03-01"}
 ])assert.equal((await call("tools/call",{name:"consultar_indicador",arguments:args})).body.result.isError,true);
});
test("el endpoint requiere clave antes de llamar a herramientas; rotación protegida por superadmin",async()=>{
 const route=[];
 const app={post:(path,...h)=>route.push({method:"POST",path,h}),
  get:(path,...h)=>route.push({method:"GET",path,h}),
  delete:(path,...h)=>route.push({method:"DELETE",path,h})};
 setupPublicDemoMcp(app,pool,{requireSuperadmin:(_req,_res,next)=>next()});
 const handler=route.find(x=>x.method==="POST"&&x.path==="/api/mcp-demo").h[0];
 const invoke=async auth=>{
  let status=200,body;
  const res={
    status(n){status=n;return this},set(){return this},
    json(x){body=x;return this},end(){return this}
  };
  await handler({get:k=>k==="authorization"?auth:"",body:{jsonrpc:"2.0",id:1,method:"tools/list"}},res,e=>{throw e});
  return {status,body};
 };
 assert.equal((await invoke("")).status,401);
 assert.equal((await invoke("Bearer "+generateDemoKey())).status,401);
 assert.equal((await invoke("Bearer "+secret)).body.result.tools.length,4);
 assert.equal(route.filter(x=>x.path==="/api/admin/ai/mcp-demo").length,3);
});
