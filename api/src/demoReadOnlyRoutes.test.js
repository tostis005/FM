import test from "node:test";
import assert from "node:assert/strict";
import {isDemoReadOnlyPost} from "./demoReadOnlyRoutes.js";

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
