import test from "node:test";
import assert from "node:assert/strict";
import {readOrderLinesFromSheets} from "./orderExcelImport.js";

const pharmacies=[{id:1,name:"Farmacia Centro"},{id:2,name:"Farmacia Norte"}];
test("importar parafarmacia desde hoja Pedido central",()=>{
 const report={"Pedido central Pedia":[
  ["Cliente","Código nacional / EAN","Artículo","Unidades","Comentarios"],
  ["Pedia",123456,"Producto de prueba",4,""],
  ["Pedia",123457,"Otro producto",0,""]
 ]};
 const result=readOrderLinesFromSheets(report,pharmacies,"parafarmacia");
 assert.equal(result.lines.length,1);
 assert.equal(result.lines[0].reference,"123456");
 assert.equal(result.lines[0].units,4);
 assert.equal(result.units,4);
});
test("importar medicación conserva reparto por farmacia",()=>{
 const report={"Pedidos por farmacia":[
  ["Código nacional / EAN","Artículo","Pedir Farmacia Centro","Pedir Farmacia Norte","Total pedir","Comentarios"],
  [523456,"Medicamento de prueba",3,2,5,""]
 ]};
 const result=readOrderLinesFromSheets(report,pharmacies,"medicacion");
 assert.deepEqual(result.lines[0].unitsByPharmacy,{"1":3,"2":2});
 assert.equal(result.units,5);
});
test("no atribuye medicamento a varias farmacias sin desglose",()=>{
 assert.throws(()=>readOrderLinesFromSheets({"Pedido":[
  ["CN","Artículo","Unidades"],["523456","Medicamento",5]
 ]},pharmacies,"medicacion"),/columna/);
});
test("bloquea cantidades inválidas y CN de otra categoría",()=>{
 assert.throws(()=>readOrderLinesFromSheets({"Pedido":[
  ["CN","Artículo","Unidades"],["123456","Prueba",-5]
 ]},pharmacies,"parafarmacia"),/Cantidad/);
 assert.throws(()=>readOrderLinesFromSheets({"Pedido":[
  ["CN","Artículo","Unidades"],["523456","Medicación",3]
 ]},pharmacies,"parafarmacia"),/categoría/);
});
