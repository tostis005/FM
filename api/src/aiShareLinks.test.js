import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {createHash} from "node:crypto";
import {setupTemporaryAnalyticsLinks,validTemporaryLinkToken} from "./aiShareLinks.js";

const hash=s=>createHash("sha256").update(s).digest("hex");

test("24-hour link: real PostgreSQL, expiry, revocation, tenant and admin protection",async()=>{
 let active=null, expired=false;
 const statements=[];
 const pool={
  query:async(sql,params=[])=>{
   statements.push({sql,params});
   if(sql.startsWith("SELECT slug FROM farmetrica.clientes"))return {rows:[{slug:"grupo_demo"}]};
   if(sql.startsWith("INSERT INTO farmetrica.ai_mcp_demo_keys")){
    active={secret_hash:params[0],cliente_slug:params[1],creado_en:new Date().toISOString()};
    expired=false;return {rows:[{creado_en:active.creado_en}]};
   }
   if(sql.startsWith("DELETE FROM farmetrica.ai_mcp_demo_keys")){active=null;return {rows:[]};}
   if(sql.startsWith("SELECT cliente_slug,creado_en FROM farmetrica.ai_mcp_demo_keys"))
    return {rows:active&&!expired?[{cliente_slug:active.cliente_slug,creado_en:active.creado_en}]:[]};
   if(sql.startsWith("SELECT cliente_slug FROM farmetrica.ai_mcp_demo_keys"))
    return {rows:active&&!expired&&active.secret_hash===params[0]?[{cliente_slug:active.cliente_slug}]:[]};
   if(sql.includes("SELECT slug,nombre,esquema_datos FROM farmetrica.clientes"))
    return {rows:[{slug:"grupo_demo",nombre:"Grupo de pruebas real",esquema_datos:"grupo_demo"}]};
   if(sql.includes("SELECT id,nombre AS name,ciudad AS city"))
    return {rows:[{id:101,name:"Farmacia Real Uno",city:"Madrid"}]};
   throw Error("SQL inesperado: "+sql);
  },
  connect:async()=>({
   query:async(sql,params=[])=>{
    statements.push({sql,params});
    if(sql.startsWith("SELECT f.nombre"))return {rows:[{farmacia:"Farmacia Real Uno",importe:4321.09,unidades:30}]};
    return {rows:[]};
   },
   release:()=>{}
  })
 };
 const app=express();app.use(express.json());
 const superadmin=(req,res,next)=>req.get("x-test-admin")==="yes"?next():res.sendStatus(401);
 setupTemporaryAnalyticsLinks(app,pool,{requireSuperadmin:superadmin});
 const server=await new Promise(resolve=>{
  const s=app.listen(0,"127.0.0.1",()=>resolve(s));
 });
 const base="http://127.0.0.1:"+server.address().port;
 const admin="/api/admin/ai/mcp-demo";
 const opts={method:"POST",headers:{"Content-Type":"application/json","x-test-admin":"yes",
  "x-farmetrica-admin-action":"mcp-demo-key"},body:JSON.stringify({clientSlug:"grupo_demo"})};
 try{
  assert.equal((await fetch(base+admin)).status,401);
  assert.equal((await fetch(base+admin,{...opts,headers:{"x-test-admin":"yes"}})).status,403);
  const created=await fetch(base+admin,opts);
  assert.equal(created.status,200);
  assert.match(created.headers.get("cache-control"),/no-store/);
  const generated=await created.json();
  assert.match(generated.url,/^https:\/\/farmetrica\.com\/api\/consulta-temporal\/fm_share_[A-Za-z0-9_-]{43}$/);
  const token=generated.url.split("/").at(-1);
  assert.equal(validTemporaryLinkToken(token),true);
  assert.equal(validTemporaryLinkToken("fm_share_wrong"),false);
  assert.ok(new Date(generated.expiresAt)>new Date());
  assert.equal(active.secret_hash,hash(token));
  const path="/api/consulta-temporal/"+token;
  const landing=await fetch(base+path);
  assert.equal(landing.status,200);
  assert.match(await landing.text(),/Datos reales de PostgreSQL/);
  assert.match(landing.headers.get("referrer-policy"),/no-referrer/);
  const sales=await fetch(base+path+"?indicador=ventas_resumen&desde=2026-10-01&hasta=2026-10-22&formato=json");
  assert.equal(sales.status,200);
  const result=await sales.json();
  assert.equal(result.ficticio,false);
  assert.equal(result.rows[0].importe,4321.09);
  assert.equal(result.cliente,"Grupo de pruebas real");
  assert.ok(statements.some(x=>x.sql==="BEGIN TRANSACTION READ ONLY"));
  assert.ok(statements.some(x=>x.sql==="ROLLBACK"));
  assert.equal((await fetch(base+path+"?indicador=DROP%20TABLE")).status,400);
  assert.equal((await fetch(base+path+"?indicador=ventas_resumen&desde=2026-01-01&hasta=2026-12-31&farmacias=999")).status,400);
  assert.equal((await fetch(base+path+"?indicador=ventas_resumen&pregunta=hola")).status,400);
  expired=true;
  assert.equal((await fetch(base+path)).status,410);
  const renewed=await (await fetch(base+admin,opts)).json();
  assert.notEqual(renewed.url,generated.url);
  assert.equal((await fetch(base+path)).status,410);
  const revoked=await fetch(base+admin,{method:"DELETE",headers:opts.headers});
  assert.equal(revoked.status,200);
  assert.equal((await fetch(base+"/api/consulta-temporal/"+renewed.url.split("/").at(-1))).status,410);
  assert.equal((await fetch(base+"/api/consulta-temporal/fm_share_wrong")).status,404);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
