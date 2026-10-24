import test from "node:test";
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import pg from "pg";
import {setupTenant} from "./tenant.js";

test("PostgreSQL: intersección de módulos por cliente/usuario y restricciones API",{
 skip:!process.env.TEST_DB_URL
},async()=>{
 const pool=new pg.Pool({connectionString:process.env.TEST_DB_URL});
 const routes=new Map();
 const app={
  get:(name,...handlers)=>routes.set("GET "+name,handlers),
  put:(name,...handlers)=>routes.set("PUT "+name,handlers),
  post(){},patch(){},delete(){}
 };
 const {requireTenant}=setupTenant(app,pool,{
  requireUser:(req,res,next)=>next(),
  requireSuperadmin:(_req,res)=>res.status(403).json({error:"No"})
 });
 app.get("/api/analytics/pedidos/qa",...requireTenant(),(_req,res)=>res.json({ok:true}));
 const slug="modqa"+randomBytes(5).toString("hex");
 const email="modules-"+slug+"@example.invalid";
 async function call(method,path,{body={},modules=["ventas"],role="administrador"}={}){
  const auth={email,role:"usuario",tenants:[{
   slug,active:true,role,module_grants:modules,pharmacies:[]
  }]};
  const req={user:auth,path,method,body,query:{},
   get:key=>key==="x-farmetrica-cliente"?slug:""};
  const res={statusCode:200,status(v){this.statusCode=v;return this},json(data){this.data=data;return this}};
  for(const h of routes.get(method+" "+path)||[]){
   if(res.data!==undefined)break;
   let continued=false,fail;
   await h(req,res,error=>{if(error)fail=error;else continued=true;});
   if(fail)throw fail;
   if(!continued)break;
  }
  return res;
 }
 try{
  await pool.query("INSERT INTO farmetrica.clientes(slug,nombre,esquema_datos) VALUES($1,'QA módulos','ampedia')",[slug]);
  await pool.query("INSERT INTO farmetrica.cliente_modulos(cliente_slug,modulo_clave,habilitado) VALUES ($1,'ventas',true),($1,'compras',true),($1,'promociones',false)",[slug]);
  let response=await call("GET","/api/tenant/context");
  assert.equal(response.data.modules.ventas,true);
  assert.equal(response.data.modules.compras,false);
  assert.equal(response.data.modules.promociones,false);
  assert.equal((await call("GET","/api/analytics/pedidos/qa")).statusCode,403);
  assert.equal((await call("GET","/api/analytics/pedidos/qa",{modules:["compras"]})).statusCode,200);
  const list=await call("GET","/api/tenant/usuarios/modulos");
  assert.deepEqual(list.data.modules.map(m=>m.id).sort(),["compras","ventas"]);
  const body={email,name:"QA módulos",role:"administrador",pharmacies:[],
   active:true,authType:"google",modules:["ventas"]};
  const saved=await call("PUT","/api/tenant/usuarios",{body});
  assert.equal(saved.statusCode,200);
  let {rows}=await pool.query("SELECT modulos FROM farmetrica.usuario_clientes WHERE email=$1 AND cliente_slug=$2",[email,slug]);
  assert.deepEqual(rows[0].modulos,["ventas"]);
  assert.equal((await call("PUT","/api/tenant/usuarios",{body:{...body,modules:["promociones"]}})).statusCode,400);
  assert.equal((await call("PUT","/api/tenant/usuarios",{body:{...body,modules:["compras"]}})).statusCode,403);
  assert.equal((await call("PUT","/api/tenant/usuarios",{body:{...body,modules:["compras"]},role:"gestor"})).statusCode,403);
  await pool.query("UPDATE farmetrica.cliente_modulos SET habilitado=false WHERE cliente_slug=$1 AND modulo_clave='ventas'",[slug]);
  response=await call("GET","/api/tenant/context");
  assert.equal(response.data.modules.ventas,false);
  rows=(await pool.query("SELECT modulos FROM farmetrica.usuario_clientes WHERE email=$1 AND cliente_slug=$2",[email,slug])).rows;
  assert.deepEqual(rows[0].modulos,["ventas"]);
 }finally{
  await pool.query("DELETE FROM farmetrica.clientes WHERE slug=$1",[slug]).catch(()=>{});
  await pool.query("DELETE FROM public.acceso_cuentas WHERE email=$1",[email]).catch(()=>{});
  await pool.end();
 }
});
