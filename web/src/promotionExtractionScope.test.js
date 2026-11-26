import test from "node:test";
import assert from "node:assert/strict";
import {promotionWarehouses,promotionExtractionScope,nameExtractionRow} from "./promotionExtractionScope.js";
const warehouse={id:9,name:"Almacén",promotionExportName:"Ampedia Mercantil",active:true};
test("solo perfiles autorizados y almacenes activos",()=>{
 for(const role of ["gestor","administrador","superadministrador"])
  assert.deepEqual(promotionWarehouses(role,[warehouse,{id:8,active:false}]),[warehouse]);
 for(const role of ["farmacia",undefined])assert.deepEqual(promotionWarehouses(role,[warehouse]),[]);
});
test("la extracción añade el almacén sin modificar los objetivos",()=>{
 const ids=["1","1","2"];
 const scope=promotionExtractionScope(ids,[warehouse,warehouse,{id:8,active:false}]);
 assert.deepEqual(scope.scopeIds,["1","2","9"]);
 assert.deepEqual(ids,["1","1","2"]);
 assert.equal(scope.includeWarehouses,true);
 assert.deepEqual(scope.warehouseNames,{"9":"Ampedia Mercantil"});
 assert.equal(scope.warehouses[0].name,"Ampedia Mercantil");
 assert.equal(nameExtractionRow({pharmacyId:9,pharmacyName:"Almacén"},scope.warehouseNames).pharmacyName,"Ampedia Mercantil");
 const pharmacy={pharmacyId:1,pharmacyName:"Farmacia A"};
 assert.equal(nameExtractionRow(pharmacy,scope.warehouseNames),pharmacy);
});
test("sin selección no consulta almacén; sin alias usa el nombre público",()=>{
 assert.deepEqual(promotionExtractionScope([],[warehouse]).scopeIds,[]);
 assert.equal(promotionExtractionScope([],[warehouse]).includeWarehouses,false);
 assert.equal(promotionExtractionScope(["1"],[{id:9,name:"Almacén"}]).warehouseNames["9"],"Almacén");
 assert.equal(promotionExtractionScope(["1"],[]).includeWarehouses,false);
});
