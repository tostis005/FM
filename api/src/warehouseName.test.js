import test from "node:test";
import assert from "node:assert/strict";
import {setupTenant} from "./tenant.js";

function fixture(){
 const routes=new Map(),updates=[];
 const stores=[
  {id:"1",name:"Abadía",city:"",active:true,sourceCode:"ABA",
   sourceHost:"",sourceDatabase:"Farmatic",establishmentType:"farmacia"},
  {id:"6",name:"Almacén central",city:"",active:true,sourceCode:"ALMACEN",
   sourceHost:"sql.internal",sourceDatabase:"Farmatic",establishmentType:"almacen"}
 ];
 const app=new Proxy({}, {get(_,method)=> (path,...handlers)=>{
  if(typeof path==="string")routes.set(String(method).toUpperCase()+" "+path,handlers);
 }});
 const pool={async query(sql,args=[]){
  if(sql.includes("SELECT slug,nombre,esquema_datos,activo,analisis_abcd_meses"))
   return {rows:[{slug:"ampedia",nombre:"Ampedia",esquema_datos:"ampedia",
    activo:true,analisis_abcd_meses:12,demo_origen_slug:null}]};
  if(sql.includes("SELECT modulo_clave AS id,habilitado AS enabled"))
   return {rows:[{id:"stock",enabled:true}]};
  if(sql.includes("FROM farmetrica.farmacias f WHERE f.cliente_slug"))
   return {rows:stores};
  if(sql.includes("UPDATE farmetrica.farmacias SET nombre=$3,actualizado_en=now()")){
   updates.push({sql,args});
   const wh=stores.find(s=>s.id===String(args[0])&&s.sourceCode==="ALMACEN"&&args[1]==="ampedia");
   if(!wh)return {rows:[]};
   wh.name=args[2];return {rows:[{id:wh.id,name:wh.name,sourceCode:wh.sourceCode}]};
  }
  return {rows:[]};
 }};
 setupTenant(app,pool,{requireUser:(req,res,next)=>next(),
  requireSuperadmin:(req,res,next)=>next()});
 async function call(role,id,body){
  const handlers=routes.get("PATCH /api/tenant/establecimientos/:id");
  assert.ok(handlers,"Ruta de edición de almacén disponible");
  const user={role,tenants:role==="superadministrador"?[]:[{
   slug:"ampedia",active:true,role,pharmacies:[1,6]}]};
  const req={get:k=>k==="x-farmetrica-cliente"?"ampedia":undefined,query:{},
   user,params:{id},body};
  let status=200,response;
  const res={status:n=>{status=n;return res},json:v=>{response=v;return res}};
  for(const handler of handlers){
   let proceeded=false;
   await handler(req,res,err=>{if(err)throw err;proceeded=true});
   if(!proceeded)break;
  }
  return {status,response};
 }
 return {call,stores,updates};
}
test("Renombra almacén a ALM sin alterar identificador, código, host ni base de datos",async()=>{
 const f=fixture();
 const r=await f.call("superadministrador","6",{
  name:"  ALM  ",sourceCode:"OTRO",sourceHost:"intruso",sourceDatabase:"Otra"
 });
 assert.equal(r.status,200);
 assert.deepEqual(r.response,{id:"6",name:"ALM",sourceCode:"ALMACEN",establishmentType:"almacen"});
 assert.equal(f.stores[1].id,"6");
 assert.equal(f.stores[1].sourceCode,"ALMACEN");
 assert.equal(f.stores[1].sourceHost,"sql.internal");
 assert.equal(f.stores[1].sourceDatabase,"Farmatic");
 assert.equal(f.updates.length,1);
 assert.deepEqual(f.updates[0].args,[6,"ampedia","ALM"]);
 assert.match(f.updates[0].sql,/codigo_origen\)\)='ALMACEN'/);
});
test("Un gestor o un usuario farmacia no puede editar el almacén",async()=>{
 const f=fixture();
 assert.equal((await f.call("gestor","6",{name:"Otro"})).status,403);
 assert.equal((await f.call("farmacia","6",{name:"Otro"})).status,403);
 assert.equal(f.updates.length,0);
});
test("La ruta no permite modificar nombres de farmacias ni campos vacíos",async()=>{
 const f=fixture();
 assert.equal((await f.call("superadministrador","6",{name:"  "})).status,400);
 assert.equal((await f.call("superadministrador","1",{name:"ALM"})).status,404);
 assert.equal(f.stores[0].name,"Abadía");
});
