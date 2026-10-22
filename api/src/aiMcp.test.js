import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {tenantChoices,validPkce,validAuthorizeRequest,readAnalytics,MCP_TOOLS} from "./aiMcp.js";

const CLIENT="https://chatgpt.com/oauth/client.json";
const REDIRECT="https://chatgpt.com/connector_platform_oauth_redirect";
const client={redirect_uris:[REDIRECT],scope:"farmetrica.read offline_access"};
const URLS={resource:"https://fm.example/api/mcp",demoResource:"https://fm.example/api/mcp-demo"};
const challenge=createHash("sha256").update("a".repeat(64)).digest("base64url");
const params={response_type:"code",client_id:CLIENT,redirect_uri:REDIRECT,code_challenge_method:"S256",
  code_challenge:challenge,resource:URLS.resource,state:"opaque",scope:"farmetrica.read offline_access"};

test("OAuth exige callback registrado, recurso, permisos y PKCE S256",()=>{
  assert.equal(validAuthorizeRequest(params,URLS,client),true);
  assert.equal(validAuthorizeRequest({...params,resource:URLS.demoResource},URLS,client),true);
  assert.equal(validAuthorizeRequest({...params,redirect_uri:"https://evil.example/callback"},URLS,client),false);
  assert.equal(validAuthorizeRequest({...params,resource:"https://evil.example/api/mcp"},URLS,client),false);
  assert.equal(validAuthorizeRequest({...params,code_challenge_method:"plain"},URLS,client),false);
  assert.equal(validAuthorizeRequest({...params,scope:"admin.write"},URLS,client),false);
  assert.equal(validPkce("a".repeat(64),challenge),true);
  assert.equal(validPkce("b".repeat(64),challenge),false);
  assert.equal(validPkce("bad",challenge),false);
});

test("las herramientas son estrictamente lectura y nunca aceptan SQL libre",()=>{
  assert.equal(MCP_TOOLS.length,6);
  assert.ok(MCP_TOOLS.some(t=>t.name==="catalogo_semantico"));
  const flexible=MCP_TOOLS.find(t=>t.name==="consultar_semantica");
  assert.ok(flexible.inputSchema.required.includes("fuente"));
  assert.ok(flexible.inputSchema.properties.agrupar.items.enum.includes("vendedor"));
  assert.equal(flexible.inputSchema.properties.sql,undefined);
  for(const item of MCP_TOOLS){
    assert.equal(item.annotations.readOnlyHint,true);
    assert.equal(item.inputSchema.additionalProperties,false);
  }
  const indicator=MCP_TOOLS.find(x=>x.name==="consultar_indicador");
  assert.equal(indicator.inputSchema.properties.indicador.enum.includes("ahorro_economico"),true);
  assert.equal(Object.keys(indicator.inputSchema.properties).includes("sql"),false);
});

test("consulta con farmacia autorizada, transacción READ ONLY y rollback",async()=>{
  const calls=[];
  const db={query:async(text,params)=>{calls.push({text,params});return {rows:[{farmacia:"Abadía",importe:200}]};},release:()=>calls.push({text:"released"})};
  const pool={connect:async()=>db};
  const context={role:"gestor",client:{slug:"ampedia",schema:"ampedia"},
    modules:{ventas:true,compras:true},allowedPharmacyIds:[1,2]};
  const result=await readAnalytics(pool,context,"ventas_resumen",{from:"2026-10-01",to:"2026-10-22"},[1]);
  assert.equal(result.available,true);
  assert.match(calls[0].text,/READ ONLY/);
  assert.equal(calls.some(x=>x.text==="ROLLBACK"),true);
  assert.equal(calls.at(-1).text,"released");
  const query=calls.find(x=>x.params);
  assert.deepEqual(query.params[2],[1]);
  assert.equal(query.params[3],"ampedia");
  assert.match(query.text,/f\.cliente_slug=\$4/);
  await assert.rejects(readAnalytics(pool,context,"ventas_resumen",{from:"2026-10-01",to:"2026-10-22"},[9]),/autorizadas/);
  await assert.rejects(readAnalytics(pool,context,"DROP TABLE",{from:"2026-10-01",to:"2026-10-22"},[]),/desconocido/);
  assert.equal(calls.filter(x=>x.text==="BEGIN TRANSACTION READ ONLY").length,1);
});


test("MCP tenant choices match web superadmin and membership policy",async()=>{
 const pool={query:async sql=>{assert.match(sql,/WHERE activo=true/);return {rows:[{slug:"ampedia"},{slug:"other"}]};}};
 assert.deepEqual(await tenantChoices(pool,{role:"superadministrador",tenants:[]}),["ampedia","other"]);
 assert.deepEqual(await tenantChoices(pool,{role:"administrador",tenants:[]}),[]);
 assert.deepEqual(await tenantChoices(pool,{role:"gestor",tenants:[{slug:"ampedia",active:true},{slug:"other",active:false},{slug:"disabled_client",active:true}]}),["ampedia"]);
 assert.deepEqual(await tenantChoices(pool,null),[]);
});
