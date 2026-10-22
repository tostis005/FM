import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import {createHash} from "node:crypto";
import {setupAIMcp} from "./aiMcp.js";

for(const superAdmin of [false,true])test("OAuth complete flow, superadmin="+superAdmin,async()=>{
  process.env.AI_MCP_ENABLED="true";
  process.env.AI_MCP_PUBLIC_ORIGIN="https://fm.example";
  const clients=new Map(),codes=new Map(),connections=[];
  const pool={query:async(sql,p)=>{
    if(sql.startsWith("SELECT slug FROM farmetrica.clientes"))return {rows:[{slug:"pharmacy"}]};
    if(sql.startsWith("INSERT INTO farmetrica.ai_oauth_clientes")){clients.set(p[0],p[1]);return {rows:[]};}
    if(sql.startsWith("SELECT metadata"))return {rows:clients.has(p[0])?[{metadata:clients.get(p[0])}]:[]};
    if(sql.startsWith("INSERT INTO farmetrica.ai_oauth_codigos")){
      const keys=["code_hash","email","metodo_acceso","cliente_slug","client_id","redirect_uri","challenge","scope","resource"];
      codes.set(p[0],Object.fromEntries(keys.map((k,i)=>[k,p[i]])));return {rows:[]};
    }
    if(sql.startsWith("DELETE FROM farmetrica.ai_oauth_codigos")){const row=codes.get(p[0]);codes.delete(p[0]);return {rows:row?[row]:[]};}
    if(sql.startsWith("INSERT INTO farmetrica.ai_oauth_conexiones")){connections.push(p);return {rows:[]};}
    throw Error("Unexpected SQL: "+sql);
  }};
  const user={email:"test@example.com",source:"google",role:superAdmin?"superadministrador":"gestor",tenants:superAdmin?[]:[{slug:"pharmacy",active:true}]};
  const app=express();app.use(express.json());
  setupAIMcp(app,pool,{sessionUser:async req=>req.get("x-test-session")?user:null,
    resolveAccess:async()=>user,resolveTenant:async()=>({client:{slug:"pharmacy"}}),
    requireUser:(_req,res)=>res.sendStatus(401)});
  const server=await new Promise(resolve=>{const s=app.listen(0,"127.0.0.1",()=>resolve(s));});
  const base="http://127.0.0.1:"+server.address().port;
  const post=(path,body,headers={})=>fetch(base+path,{method:"POST",redirect:"manual",
    headers:{"Content-Type":"application/x-www-form-urlencoded",...headers},body:new URLSearchParams(body)});
  try{
    const discovery=await (await fetch(base+"/.well-known/oauth-authorization-server")).json();
    assert.equal(discovery.registration_endpoint,"https://fm.example/api/ai/oauth/register");
    const registration=await fetch(base+"/api/ai/oauth/register",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({client_name:"Future AI",redirect_uris:["https://future-ai.example/callback"],
        grant_types:["authorization_code","refresh_token"],token_endpoint_auth_method:"none"})});
    assert.equal(registration.status,201);
    const {client_id}=await registration.json();
    const verifier="v".repeat(64);
    const params={client_id,redirect_uri:"https://future-ai.example/callback",response_type:"code",state:"state",
      scope:"farmetrica.read offline_access",resource:"https://fm.example/api/mcp",code_challenge_method:"S256",
      code_challenge:createHash("sha256").update(verifier).digest("base64url")};
    const authorize="/api/ai/oauth/authorize";
    let response=await fetch(base+authorize+"?"+new URLSearchParams(params),{redirect:"manual"});
    assert.equal(response.status,302);assert.ok(response.headers.get("location").startsWith("/login?next="));
    response=await fetch(base+authorize+"?"+new URLSearchParams({...params,redirect_uri:"https://attacker.example/cb"}),{redirect:"manual"});
    assert.equal(response.status,400);
    response=await fetch(base+authorize+"?"+new URLSearchParams(params),{headers:{"x-test-session":"yes"}});
    assert.equal(response.status,200);assert.match(await response.text(),/Future AI/);
    const consent={...params,confirm:"yes",tenant:"pharmacy"};
    assert.equal((await post(authorize,consent,{"x-test-session":"yes",Origin:"https://evil.example"})).status,403);
    assert.equal((await post(authorize,{...consent,tenant:"unauthorized"},{"x-test-session":"yes",Origin:"https://fm.example"})).status,403);
    assert.equal(codes.size,0);
    response=await post(authorize,consent,{"x-test-session":"yes",Origin:"https://fm.example"});
    assert.equal(response.status,302);
    const code=new URL(response.headers.get("location")).searchParams.get("code");
    const token={grant_type:"authorization_code",client_id,redirect_uri:params.redirect_uri,resource:params.resource,code,code_verifier:verifier};
    response=await post("/api/ai/oauth/token",token);
    assert.equal(response.status,200);assert.equal(response.headers.get("cache-control"),"no-store");
    const result=await response.json();assert.ok(result.access_token);assert.ok(result.refresh_token);
    assert.equal(connections.length,1);assert.notEqual(connections[0][6],result.access_token);
    assert.equal((await post("/api/ai/oauth/token",token)).status,400);
    assert.equal((await post("/api/ai/oauth/token",{...token,resource:"https://other.example/mcp"})).status,400);
    assert.equal((await post("/api/mcp",{jsonrpc:"2.0"})).status,401);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
