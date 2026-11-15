import test from "node:test";
import assert from "node:assert/strict";
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
