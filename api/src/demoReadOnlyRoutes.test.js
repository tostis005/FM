import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {demoRequestIsReadOnly} from "./demoReadOnlyRoutes.js";

test("las consultas POST del preparador son de solo lectura",()=>{
 for(const path of [
  "/analytics/pedidos/matriz-conjunta",
  "/analytics/pedidos/matriz-referencias",
  "/analytics/pedidos/laboratorios"
 ])assert.equal(demoRequestIsReadOnly("POST",path),true,path);
});
test("nunca habilitar escrituras, confirmaciones ni rutas parecidas",()=>{
 for(const path of [
  "/analytics/pedidos/borrador-laboratorio",
  "/analytics/pedidos/agenda/realizados",
  "/operativa",
  "/promociones",
  "/analytics/pedidos/matriz-conjunta/guardar",
  "/analytics/pedidos/matriz-referencias/guardar",
  "/analytics/pedidos/laboratorios/actualizar",
  "/analytics/pedidos/matriz-referencias/",
  "/admin/clientes",
  "/analytics/pedidos/propuesta"
 ])assert.equal(demoRequestIsReadOnly("POST",path),false,path);
 for(const method of ["PUT","PATCH","DELETE"])
  for(const path of ["/analytics/pedidos/matriz-conjunta","/analytics/pedidos/matriz-referencias"])
   assert.equal(demoRequestIsReadOnly(method,path),false,method+" "+path);
 for(const method of ["GET","HEAD","OPTIONS"])
  assert.equal(demoRequestIsReadOnly(method,"/analytics/pedidos/matriz-conjunta"),true);
});

test("Express entrega rutas relativas a /api al filtro de demos",async()=>{
 const app=express();
 app.use("/api",(req,res)=>{
  const ok=demoRequestIsReadOnly(req.method,req.path);
  res.status(ok?200:403).json({path:req.path});
 });
 const server=await new Promise(resolve=>{
  const s=app.listen(0,"127.0.0.1",()=>resolve(s));
 });
 try{
  const origin="http://127.0.0.1:"+server.address().port;
  for(const path of ["/analytics/pedidos/matriz-conjunta",
   "/analytics/pedidos/matriz-referencias","/analytics/pedidos/laboratorios"]){
   const response=await fetch(origin+"/api"+path,{method:"POST"});
   assert.equal(response.status,200,path);
   assert.equal((await response.json()).path,path);
  }
  for(const path of ["/analytics/pedidos/borrador-laboratorio",
   "/analytics/pedidos/agenda/realizados","/operativa"]){
   const response=await fetch(origin+"/api"+path,{method:"POST"});
   assert.equal(response.status,403,path);
  }
 }finally{
  await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
 }
});
