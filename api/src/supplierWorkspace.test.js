import test from "node:test";
import assert from "node:assert/strict";
import {setupSupplierWorkspace} from "./supplierWorkspace.js";

function makeApp(){
 const routes=new Map(),app={};
 for(const method of ["get","post","put","delete"])
  app[method]=(path,...handlers)=>routes.set(method.toUpperCase()+" "+path,handlers);
 return {app,routes};
}
async function call(routes,method,path,{role="administrador",slug="ampedia",body={}}={}){
 const middleware=routes.get(method+" "+path);
 assert.ok(middleware,"Route registered: "+method+" "+path);
 const request={context:{role,client:{slug}},body,params:{},get:()=>""};
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
test("category list is scoped to client and requires a manager",async()=>{
 const {app,routes}=makeApp();
 const queries=[];
 const pool={query:async(sql,args)=>{
  queries.push({sql,args});return {rows:[{id:"7",name:"Tarifas",active:true}]};
 }};
 setupSupplierWorkspace(app,pool,{requireTenant:()=>[]});
 const denied=await call(routes,"GET","/api/tenant/proveedor-documento-categorias",{role:"farmacia"});
 assert.equal(denied.status,403);
 assert.equal(queries.length,0);
 const allowed=await call(routes,"GET","/api/tenant/proveedor-documento-categorias",{role:"gestor",slug:"grupo_x"});
 assert.equal(allowed.status,200);
 assert.equal(allowed.data[0].name,"Tarifas");
 assert.deepEqual(queries[0].args,["grupo_x"]);
 assert.match(queries[0].sql,/WHERE cliente_slug=\$1/);
});
test("document categories are configurable by client managers, not pharmacy staff",async()=>{
 const {app,routes}=makeApp();
 let args;
 const pool={query:async(sql,values)=>{
  args=values;return {rows:[{id:"8",name:"Condiciones comerciales",active:true}]};
 }};
 setupSupplierWorkspace(app,pool,{requireTenant:()=>[]});
 const path="/api/tenant/proveedor-documento-categorias";
 const denied=await call(routes,"POST",path,{role:"farmacia",body:{name:"Condiciones comerciales"}});
 assert.equal(denied.status,403);
 const invalid=await call(routes,"POST",path,{role:"gestor",body:{name:"A"}});
 assert.equal(invalid.status,400);
 const allowed=await call(routes,"POST",path,{role:"gestor",slug:"ampedia",body:{name:"Condiciones comerciales"}});
 assert.equal(allowed.status,201);
 assert.deepEqual(args,["ampedia","Condiciones comerciales"]);
});
