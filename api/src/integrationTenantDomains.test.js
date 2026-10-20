import test from "node:test";
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import pg from "pg";
import {setupTenant} from "./tenant.js";

test("PostgreSQL: superadmin administra dominios por cliente sin mezclar farmacias",{
 skip:!process.env.TEST_DB_URL
},async()=>{
 const pool=new pg.Pool({connectionString:process.env.TEST_DB_URL});
 const endpoints=new Map();
 const app={
  get:(path,...handlers)=>endpoints.set("GET "+path,handlers),
  put:(path,...handlers)=>endpoints.set("PUT "+path,handlers),
  delete:(path,...handlers)=>endpoints.set("DELETE "+path,handlers),
  post(){},patch(){}
 };
 const requireUser=(req,res,next)=>next();
 const requireSuperadmin=(req,res,next)=>req.user?.role==="superadministrador"?
  next():res.status(403).json({error:"Acceso denegado"});
 setupTenant(app,pool,{requireUser,requireSuperadmin});
 const slug="qa"+randomBytes(5).toString("hex"),domain=slug+".example.test";
 async function run(method,path,{params={},body={},role="superadministrador"}={}){
  const handlers=endpoints.get(method+" "+path);
  assert.ok(handlers,"Ruta ausente "+path);
  const req={params,body,user:{role},get:()=>"",query:{}};
  const res={statusCode:200,status(n){this.statusCode=n;return this},
   json(data){this.data=data;return this}};
  for(const handler of handlers){
   if(res.data)break;
   let called=false,error;
   await handler(req,res,e=>{if(e)error=e;else called=true});
   if(error)throw error;
   if(!called)break;
  }
  return res;
 }
 try{
  await pool.query(
   "INSERT INTO farmetrica.clientes(slug,nombre,esquema_datos) VALUES($1,'QA','ampedia')",[slug]);
  const path="/api/admin/clientes/:slug/dominios";
  const denied=await run("PUT",path,{
   params:{slug:"ampedia"},body:{domain,active:true,pharmacyId:""},role:"colaborador"});
  assert.equal(denied.statusCode,403);
  const foreign=await run("PUT",path,{
   params:{slug:"ampedia"},body:{domain,active:true,pharmacyId:"9999999"}});
  assert.equal(foreign.statusCode,400);
  const created=await run("PUT",path,{
   params:{slug:"ampedia"},body:{domain,active:true,pharmacyId:""}});
  assert.equal(created.statusCode,200);
  assert.equal(created.data.domain,domain);
  const duplicate=await run("PUT",path,{
   params:{slug},body:{domain,active:true,pharmacyId:""}});
  assert.equal(duplicate.statusCode,409);
  const disabled=await run("PUT",path,{
   params:{slug:"ampedia"},body:{domain,active:false,pharmacyId:""}});
  assert.equal(disabled.statusCode,200);
  assert.equal(disabled.data.active,false);
  const records=await run("GET",path,{params:{slug:"ampedia"}});
  assert.ok(records.data.some(d=>d.domain===domain&&d.active===false));
 }finally{
  await pool.query("DELETE FROM farmetrica.cliente_dominios WHERE dominio=$1",[domain]).catch(()=>{});
  await pool.query("DELETE FROM farmetrica.clientes WHERE slug=$1",[slug]).catch(()=>{});
  await pool.end();
 }
});
