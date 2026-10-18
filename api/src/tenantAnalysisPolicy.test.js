import test from "node:test";
import assert from "node:assert/strict";
import {setupTenant} from "./tenant.js";

function fixture(role="administrador"){
 const routes=new Map(),calls=[];
 let persistedMonths=12;
 const app={
  get(path,...handlers){routes.set("GET "+path,handlers)},
  put(path,...handlers){routes.set("PUT "+path,handlers)},
  post(){},patch(){},delete(){}
 };
 const pool={async query(sql,params=[]){
  calls.push({sql,params});
  if(sql.includes("FROM farmetrica.clientes WHERE slug=$1"))
   return {rows:[{slug:"ampedia",nombre:"Ampedia",esquema_datos:"ampedia",
     activo:true,analisis_abcd_meses:persistedMonths}]};
  if(sql.includes("FROM farmetrica.cliente_modulos"))
   return {rows:[{id:"ventas",enabled:true}]};
  if(sql.includes("FROM farmetrica.farmacias WHERE cliente_slug"))
   return {rows:[{id:"5",name:"Valdemarías",active:true,sourceCode:"POL"}]};
  if(sql.includes("UPDATE farmetrica.clientes SET analisis_abcd_meses=$1")){
   persistedMonths=params[0];
   return {rows:[{analisis_abcd_meses:persistedMonths}]};
  }
  if(sql.includes("SELECT slug,nombre AS name FROM farmetrica.clientes"))
   return {rows:[{slug:"ampedia",name:"Ampedia"}]};
  throw Error("SQL inesperado: "+sql);
 }};
 setupTenant(app,pool,{requireUser:(_req,_res,next)=>next(),
  requireSuperadmin:(_req,_res,next)=>next()});
 const user={email:"demo@example.com",role:"usuario",tenants:[{slug:"ampedia",role,active:true,pharmacies:[5]}]};
 async function request(method,path,body={},session=user){
  const handlers=routes.get(method+" "+path);
  assert.ok(handlers,"Debe existir ruta "+path);
  let status=200,response;
  const req={body,query:{},user:session,get:()=>"ampedia"};
  const res={status(n){status=n;return res},json(data){response=data;return res}};
  let nextCount=0,error;
  // Auth externa ya autenticó el usuario; ejercitar middleware de tenant y rol.
  await handlers[1](req,res,e=>{if(e)error=e;else nextCount++});
  if(nextCount===1){
   await handlers[2](req,res,e=>{if(e)error=e});
  }
  if(error)throw error;
  return {status,response};
 }
 return {request,calls,getMonths:()=>persistedMonths,user};
}

test("ABCD del cliente inicia en 12 meses y lo puede actualizar un administrador",async()=>{
 const {request,getMonths,calls}=fixture();
 const first=await request("GET","/api/tenant/context");
 assert.equal(first.status,200);
 assert.equal(first.response.client.analysisMonths,12);
 const updated=await request("PUT","/api/tenant/configuracion-ventas",{analysisMonths:24});
 assert.equal(updated.status,200);
 assert.equal(updated.response.analysisMonths,24);
 assert.equal(getMonths(),24);
 assert.equal(calls.filter(c=>c.sql.includes("UPDATE farmetrica.clientes")).length,1);
 const reloaded=await request("GET","/api/tenant/context");
 assert.equal(reloaded.response.client.analysisMonths,24);
});

test("gestor y personal de farmacia no pueden modificar el período",async()=>{
 for(const role of ["gestor","farmacia","colaborador"]){
  const {request,calls}=fixture(role);
  const denied=await request("PUT","/api/tenant/configuracion-ventas",{analysisMonths:3});
  assert.equal(denied.status,403);
  assert.equal(calls.filter(c=>c.sql.includes("UPDATE farmetrica.clientes")).length,0);
 }
});

test("un administrador no puede guardar meses inválidos",async()=>{
 const {request,calls}=fixture();
 for(const invalid of [0,5,13,"12",null,-1,60]){
  const r=await request("PUT","/api/tenant/configuracion-ventas",{analysisMonths:invalid});
  assert.equal(r.status,400);
 }
 assert.equal(calls.filter(c=>c.sql.includes("UPDATE farmetrica.clientes")).length,0);
});
