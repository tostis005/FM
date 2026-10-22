import test from "node:test";
import assert from "node:assert/strict";
import {handlePublicDemoMcp,setupPublicDemoMcp} from "./aiMcpDemo.js";
const call=(method,params={},id=1)=>handlePublicDemoMcp({jsonrpc:"2.0",id,method,params});
test("MCP demo exposes protocol and four read-only tools without authentication",()=>{
  assert.equal(call("initialize").body.result.serverInfo.name,"Farmetrica Demo Ficticia");
  const list=call("tools/list").body.result.tools;
  assert.equal(list.length,4);
  for(const tool of list) assert.equal(tool.annotations.readOnlyHint,true);
  assert.equal(call("notifications/initialized").http,202);
});
test("all public data is clearly fictitious and uses only synthetic pharmacies",()=>{
  const context=call("tools/call",{name:"listar_contexto"}).body.result.structuredContent;
  assert.equal(context.ficticio,true);
  assert.equal(context.farmacias.length,3);
  assert.equal(context.farmacias.every(p=>p.id>=90001 && p.nombre.includes("Ejemplo")),true);
  const catalog=call("tools/call",{name:"catalogo_analitico"}).body.result.structuredContent;
  assert.equal(catalog.ficticio,true);
  for(const indicator of Object.keys(catalog.indicadores)){
    const row=call("tools/call",{name:"consultar_indicador",arguments:{indicador:indicator,desde:"2026-10-01",hasta:"2026-10-22"}}).body.result.structuredContent;
    assert.equal(row.ficticio,true);
    assert.match(row.aviso,/SINTÉTICOS/);
    assert.equal(row.farmacias.every(p=>p.farmacia.includes("Ejemplo")),true);
  }
});
test("rejects arbitrary SQL, real pharmacy identifiers and unintended arguments",()=>{
  const query=(args)=>call("tools/call",{name:"consultar_indicador",arguments:args}).body.result;
  assert.equal(query({indicador:"DROP TABLE foo"}).isError,true);
  assert.equal(query({indicador:"compras_resumen",farmacias:[1]}).isError,true);
  assert.equal(query({indicador:"compras_resumen",sql:"SELECT *"}).isError,true);
  assert.equal(query({indicador:"compras_resumen",desde:"2026-02-30",hasta:"2026-03-01"}).isError,true);
  assert.equal(query({indicador:"compras_resumen",desde:"2023-01-01",hasta:"2026-01-01"}).isError,true);
});
test("public endpoint never injects DB pool and handles invalid requests",()=>{
  const registered=[];
  const app={post:(path,cb)=>registered.push({method:"POST",path,cb}),
    get:(path,cb)=>registered.push({method:"GET",path,cb})};
  setupPublicDemoMcp(app);
  assert.equal(registered.length,2);
  assert.equal(registered.every(x=>x.path==="/api/mcp-demo"),true);
  assert.equal(handlePublicDemoMcp({jsonrpc:"2.0",method:"irrelevant"}).body.error.code,-32601);
  assert.equal(handlePublicDemoMcp(null).http,400);
  const r=call("tools/call",{name:"explorar_pregunta",arguments:{pregunta:"¿Cuánto compramos?"}});
  assert.equal(r.body.result.structuredContent.indicador,"compras_resumen");
});
