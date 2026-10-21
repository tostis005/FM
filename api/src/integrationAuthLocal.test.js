import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {setupAccess} from "./accesos.js";
import {hashInternalPassword} from "./internalPassword.js";

test("PostgreSQL: cuenta interna inicia sesión y no convierte usuarios Google",{
 skip:!process.env.TEST_DB_URL
},async()=>{
 const previous=process.env.SESSION_SECRET;
 process.env.SESSION_SECRET="fm_auth_ci_secure_key_test_2026_1234567890";
 const pool=new pg.Pool({connectionString:process.env.TEST_DB_URL});
 const routes=new Map(),app={
  use(){},get(path,...handlers){routes.set("GET "+path,handlers.at(-1))},
  post(path,...handlers){routes.set("POST "+path,handlers.at(-1))},
  put(){},delete(){}
 };
 setupAccess(app,pool,()=>{},false);
 const internalEmail="ci-interno@example.test",googleEmail="ci-google@example.test";
 try{
  for(const [email,method] of [[internalEmail,"local"],[googleEmail,"google"]]){
   await pool.query(
    "INSERT INTO public.acceso_cuentas(email,nombre,rol,farmacias,activo) VALUES($1,'QA','farmacia',ARRAY[5],true) ON CONFLICT(email) DO UPDATE SET activo=true",
    [email]);
   await pool.query(
    "INSERT INTO farmetrica.usuario_clientes(email,cliente_slug,rol,farmacias,activo,metodo_acceso) VALUES($1,'ampedia','farmacia',ARRAY[5],true,$2) ON CONFLICT(email,cliente_slug) DO UPDATE SET metodo_acceso=EXCLUDED.metodo_acceso,activo=true",
    [email,method]);
  }
  const pass="Clave-Demo-Segura-2026";
  const hash=await hashInternalPassword(pass);
  await pool.query("INSERT INTO farmetrica.credenciales_locales(email,password_hash) VALUES($1,$2)",[internalEmail,hash]);
  async function attempt(email,password){
   const req={body:{email,password},ip:"192.0.2.42",
    get:()=>""},r={code:200,headers:{},status(n){r.code=n;return r},
      setHeader(k,v){r.headers[k]=v;return r},
      json(b){r.body=b;return r}};
   let error;
   await routes.get("POST /api/auth/password")(req,r,e=>{error=e});
   if(error)throw error;
   return r;
  }
  const okay=await attempt(internalEmail,pass);
  assert.equal(okay.code,200);
  assert.equal(okay.body.user.source,"local");
  assert.equal(okay.body.user.tenants[0].slug,"ampedia");
  assert.match(okay.headers["Set-Cookie"],/HttpOnly.*SameSite=Lax/);
  const wrong=await attempt(internalEmail,"wrong");
  assert.equal(wrong.code,401);
  assert.equal(wrong.headers["Set-Cookie"],undefined);
  const google=await attempt(googleEmail,pass);
  assert.equal(google.code,401);
 }finally{await pool.end();if(previous===undefined)delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET=previous}
});
