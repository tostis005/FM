import test from "node:test";
import assert from "node:assert/strict";
import {isDemoReadOnlyPost,demoMutationGuard} from "./demoReadOnlyRoutes.js";
import express from "express";

test("la demo permite calcular la matriz conjunta sin escribir pedidos",()=>{
 assert.equal(isDemoReadOnlyPost("POST","/analytics/pedidos/matriz-conjunta"),true);
 assert.equal(isDemoReadOnlyPost("POST","/analytics/pedidos/matriz-referencias"),true);
});
test("la demo sigue bloqueando todos los cambios operativos",()=>{
 const forbidden=[
  ["PUT","/analytics/pedidos/borrador-laboratorio"],
  ["POST","/analytics/pedidos/agenda/realizados"],
  ["POST","/analytics/pedidos/laboratorios"],
  ["POST","/operativa"],["POST","/picking-list"],
  ["POST","/analytics/pedidos/matriz-conjunta/guardar"],
  ["POST","/analytics/pedidos/matriz-referencias/guardar"],
  ["DELETE","/analytics/pedidos/matriz-conjunta"],
  ["PATCH","/analytics/pedidos/matriz-referencias"],
  ["POST","/analytics/pedidos/matriz-conjunta/"],
  ["POST","/analytics/pedidos/matriz-conjunta?write=true"],
  ["POST","/api/analytics/pedidos/matriz-conjunta"]
 ];
 for(const [method,path] of forbidden)
  assert.equal(isDemoReadOnlyPost(method,path),false,method+" "+path);
});

test("HTTP /api: las matrices POST calculan datos y pedidos/agenda siguen bloqueados",async()=>{
 const app=express();
 app.use(express.json());
 const requireTenant=()=>[
  (req,res,next)=>{req.user={id:"ejemplo"};next()},
  (req,res,next)=>{req.context={client:{demo:true}};next()}
 ];
 app.use("/api",demoMutationGuard(requireTenant));
 for(const name of ["matriz-conjunta","matriz-referencias"]){
  app.post("/api/analytics/pedidos/"+name,
   ...requireTenant(),(req,res)=>res.json({rows:[{stock:5,units3:7}],received:req.body}));
 }
 app.post("/api/analytics/pedidos/agenda/realizados",(req,res)=>res.json({saved:true}));
 app.put("/api/analytics/pedidos/borrador-laboratorio",(req,res)=>res.json({saved:true}));
 app.post("/api/operativa",(req,res)=>res.json({saved:true}));
 app.post("/api/analytics/pedidos/matriz-referencias/guardar",(req,res)=>res.json({saved:true}));
 const server=app.listen(0,"127.0.0.1");
 try{
  await new Promise((resolve,reject)=>{
   if(server.listening)return resolve();
   server.once("listening",resolve);
   server.once("error",reject);
  });
  const origin="http://127.0.0.1:"+server.address().port;
  for(const name of ["matriz-conjunta","matriz-referencias"]){
   const response=await fetch(origin+"/api/analytics/pedidos/"+name,{
    method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({referencias:[{cn:"123456"}]})
   });
   assert.equal(response.status,200);
   const result=await response.json();
   assert.equal(result.rows[0].stock,5);
   assert.equal(result.received.referencias[0].cn,"123456");
  }
  for(const [method,path] of [
   ["POST","/api/analytics/pedidos/agenda/realizados"],
   ["PUT","/api/analytics/pedidos/borrador-laboratorio"],
   ["POST","/api/operativa"],
   ["POST","/api/analytics/pedidos/matriz-referencias/guardar"]
  ]){
   const response=await fetch(origin+path,{method});
   assert.equal(response.status,403,method+" "+path);
  }
 }finally{
  await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
 }
});
