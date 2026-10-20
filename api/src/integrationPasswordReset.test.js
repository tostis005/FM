import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {randomUUID} from "node:crypto";
import {setupAccess} from "./accesos.js";
import {hashInternalPassword} from "./internalPassword.js";

test("PostgreSQL: restablecer contraseña externa usa enlace de un solo uso sin filtrar existencia",{
 skip:!process.env.TEST_DB_URL
},async()=>{
 const savedEnv={SESSION_SECRET:process.env.SESSION_SECRET,
  PUBLIC_APP_ORIGIN:process.env.PUBLIC_APP_ORIGIN,SMTP_FROM:process.env.SMTP_FROM};
 process.env.SESSION_SECRET="fm_password_reset_ci_secret_secure_2026_1234";
 process.env.PUBLIC_APP_ORIGIN="https://farmetrica.example.test";
 process.env.SMTP_FROM="no-reply@farmetrica.example.test";
 const pool=new pg.Pool({connectionString:process.env.TEST_DB_URL});
 const routes=new Map(),sent=[];
 const app={use(){},get(path,...h){routes.set("GET "+path,h.at(-1))},
  post(path,...h){routes.set("POST "+path,h.at(-1))},put(){},delete(){}};
 setupAccess(app,pool,()=>{},false,{
  mailerOverride:{sendMail:async options=>{sent.push(options);return {messageId:"ci"}}}
 });
 const email="reset-"+randomUUID()+"@example.test";
 const original="PrimeraContraseñaFuerte2026",changed="SegundaContraseñaFuerte2026";
 try{
  await pool.query(
   "INSERT INTO public.acceso_cuentas(email,nombre,rol,farmacias,activo) VALUES($1,'CI','colaborador','{}',true)",[email]);
  await pool.query(
   "INSERT INTO farmetrica.usuario_clientes(email,cliente_slug,rol,farmacias,activo,metodo_acceso) VALUES($1,'ampedia','colaborador','{}',true,'interno')",[email]);
  await pool.query(
   "INSERT INTO farmetrica.credenciales_locales(email,password_hash,activo) VALUES($1,$2,true)",
   [email,await hashInternalPassword(original)]);
  async function post(path,body,ip){
   const req={body,ip,get:()=>""};
   const res={statusCode:200,header:{},status(code){this.statusCode=code;return this},
    setHeader(k,v){this.header[k]=v},json(value){this.body=value;return this}};
   let error;
   await routes.get("POST "+path)(req,res,e=>{error=e});
   if(error)throw error;
   return res;
  }
  const asked=await post("/api/auth/forgot-password",{email},"192.0.2.5");
  assert.equal(asked.statusCode,200);
  assert.equal(sent.length,1);
  assert.doesNotMatch(JSON.stringify(asked.body),new RegExp(email.replace(".","\\.")));
  const urlText=sent[0].text.match(/https:\/\/\S+/)?.[0];
  assert.ok(urlText,"El correo incluye un enlace");
  const reset=new URL(urlText);
  const token=reset.searchParams.get("token");
  assert.match(token,/^[a-f0-9]{64}$/);
  assert.equal(reset.searchParams.get("email"),email);
  const used=await post("/api/auth/reset-password",{email,token,password:changed},"192.0.2.5");
  assert.equal(used.statusCode,200);
  const again=await post("/api/auth/reset-password",{email,token,password:changed},"192.0.2.5");
  assert.equal(again.statusCode,400);
  const login=await post("/api/auth/password",{email,password:changed},"192.0.2.8");
  assert.equal(login.statusCode,200);
  const old=await post("/api/auth/password",{email,password:original},"192.0.2.8");
  assert.equal(old.statusCode,401);
  const unknown=await post("/api/auth/forgot-password",
   {email:"unknown-"+randomUUID()+"@example.test"},"198.51.100.6");
  assert.equal(unknown.body.message,asked.body.message);
  assert.equal(sent.length,1);
 }finally{
  await pool.query("DELETE FROM public.acceso_cuentas WHERE email=$1",[email]).catch(()=>{});
  await pool.end();
  for(const [k,v] of Object.entries(savedEnv)){
   if(v===undefined)delete process.env[k];else process.env[k]=v;
  }
 }
});
