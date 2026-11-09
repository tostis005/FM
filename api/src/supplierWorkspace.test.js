import test from "node:test";
import assert from "node:assert/strict";
import {setupSupplierWorkspace} from "./supplierWorkspace.js";
import {requestModules} from "./userModuleAccess.js";
import {requestSections} from "./userSectionAccess.js";

function makeApp(){
 const routes=new Map(),app={};
 for(const method of ["get","post","put","delete"])
  app[method]=(path,...handlers)=>routes.set(method.toUpperCase()+" "+path,handlers);
 return {app,routes};
}
async function call(routes,method,path,{role="administrador",slug="ampedia",moduleEnabled=true,body={},params={},pool=null}={}){
 const middleware=routes.get(method+" "+path);
 assert.ok(middleware,"Route registered: "+method+" "+path);
 const request={context:{role,client:{slug},modules:{proveedores:moduleEnabled}},body,params,get:()=>""};
 const result={status:200,data:null};
 const response={
  status(n){result.status=n;return this},
  json(data){result.data=data;return this}
 };
 for(const handler of middleware){
  let failed=null;
  await handler(request,response,error=>{failed=error||null});
  if(failed)throw failed;
  if(result.data!==null)break;
 }
 return result;
}
test("tenant and section grants cover every shared supplier endpoint",()=>{
 for(const path of ["/api/tenant/proveedores-unificados",
  "/api/tenant/proveedores-unificados/14/ficha",
  "/api/tenant/proveedores-unificados/14/contactos",
  "/api/tenant/proveedores-unificados/14/documentos/17/descargar",
  "/api/tenant/proveedor-documento-categorias"]){
  assert.deepEqual(requestModules({path}),["proveedores"]);
  assert.deepEqual(requestSections({path}),["proveedores"]);
 }
});
test("pharmacy users can see categories; disabled module cannot read",async()=>{
 const {app,routes}=makeApp(),queries=[];
 const pool={query:async(sql,args)=>{
  queries.push({sql,args});return {rows:[{id:"7",name:"Tarifas",active:true}]};
 }};
 setupSupplierWorkspace(app,pool,{requireTenant:()=>[]});
 const path="/api/tenant/proveedor-documento-categorias";
 const blocked=await call(routes,"GET",path,{role:"farmacia",moduleEnabled:false});
 assert.equal(blocked.status,403);
 assert.equal(queries.length,0);
 const reader=await call(routes,"GET",path,{role:"farmacia",slug:"grupo_farmacias"});
 assert.equal(reader.status,200);
 assert.equal(reader.data[0].name,"Tarifas");
 assert.deepEqual(queries[0].args,["grupo_farmacias"]);
 assert.match(queries[0].sql,/WHERE cliente_slug=\$1/);
});
test("read-only users cannot create categories, upload documents or alter contacts",async()=>{
 const {app,routes}=makeApp(),queries=[];
 const pool={query:async(sql,values)=>{queries.push([sql,values]);return {rows:[]}}};
 setupSupplierWorkspace(app,pool,{requireTenant:()=>[]});
 for(const [method,path] of [
  ["POST","/api/tenant/proveedor-documento-categorias"],
  ["POST","/api/tenant/proveedores-unificados/:id/contactos"],
  ["PUT","/api/tenant/proveedores-unificados/:id/ficha"],
  ["POST","/api/tenant/proveedores-unificados/:id/documentos"],
  ["DELETE","/api/tenant/proveedores-unificados/:id/documentos/:documentId"]]){
  for(const role of ["farmacia","colaborador"]){
   const denied=await call(routes,method,path,{role});
   assert.equal(denied.status,403,role+" "+method+" "+path);
  }
 }
 assert.equal(queries.length,0);
});
test("managers can configure shared document categories, but not without module",async()=>{
 const {app,routes}=makeApp();let args;
 const pool={query:async(sql,values)=>{
  args=values;return {rows:[{id:"8",name:"Condiciones comerciales",active:true}]};
 }};
 setupSupplierWorkspace(app,pool,{requireTenant:()=>[]});
 const path="/api/tenant/proveedor-documento-categorias";
 assert.equal((await call(routes,"POST",path,{role:"gestor",moduleEnabled:false,body:{name:"Condiciones comerciales"}})).status,403);
 assert.equal((await call(routes,"POST",path,{role:"gestor",body:{name:"A"}})).status,400);
 const allowed=await call(routes,"POST",path,{role:"gestor",slug:"ampedia",body:{name:"Condiciones comerciales"}});
 assert.equal(allowed.status,201);
 assert.deepEqual(args,["ampedia","Condiciones comerciales"]);
});

test("superadministrador may consult supplier categories with client module disabled",async()=>{
 const {app,routes}=makeApp();
 const pool={query:async()=>({rows:[{id:"7",name:"Tarifas",active:true}]})};
 setupSupplierWorkspace(app,pool,{requireTenant:()=>[]});
 const result=await call(routes,"GET","/api/tenant/proveedor-documento-categorias",{
  role:"superadministrador",moduleEnabled:false
 });
 assert.equal(result.status,200);
 assert.equal(result.data[0].name,"Tarifas");
});
