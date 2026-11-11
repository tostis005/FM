import test from "node:test";
import assert from "node:assert/strict";
import {normalizedFamilyLabel,planSameNameMerges} from "./familySameName.js";

function f(id,name,segment="SIN_DETERMINAR",options={}){
 return {id:String(id),name,segment,active:true,referencePharmacy:null,
  customName:false,linked:0,aliases:1,para:0,med:0,localNames:[],...options};
}
test("fusiona nombres idénticos con tilde, mayúsculas y prefijo 2022 sin CN comunes",()=>{
 const data=planSameNameMerges([
  f(1,"2022 - DERMOCOSMETICA","PARAFARMACIA",{referencePharmacy:"ALMACEN",linked:100}),
  f(2,"Dermocosmética","PARAFARMACIA",{linked:40}),
  f(3,"dermocosmetica","PARAFARMACIA",{linked:20})
 ]);
 assert.equal(data.actions.length,2);
 assert.equal(data.uniqueFamilies,1);
 assert.deepEqual(data.actions.map(x=>x.destinationId),["1","1"]);
 assert.equal(data.groups[0].name,"Dermocosmética");
 assert.equal(data.actions[0].reason,"mismo_nombre_mismo_segmento");
});
test("diferentes productos no bloquean nombres iguales incluso sin recuentos CN",()=>{
 const data=planSameNameMerges([
  f(21,"Ortodoncia","SIN_DETERMINAR",{linked:55,para:0,med:55}),
  f(22,"Ortodoncia","SIN_DETERMINAR",{linked:10,para:10,med:0})
 ]);
 assert.equal(data.actions.length,1);
 assert.equal(data.actions[0].toSegment,"SIN_DETERMINAR");
});
test("separación estricta entre medicación y parafarmacia",()=>{
 const data=planSameNameMerges([
  f(1,"Complementos","MEDICACION",{referencePharmacy:"ABA",med:100}),
  f(2,"Complementos","PARAFARMACIA",{referencePharmacy:"ALMACEN",para:100}),
  f(3,"Complementos","SIN_DETERMINAR",{para:45,med:55})
 ]);
 assert.equal(data.actions.length,0);
 assert.equal(data.ambiguousCrossSegment,1);
});
test("una familia sin clasificar se incorpora a categoría única solo si los CN indican el mismo tipo",()=>{
 const data=planSameNameMerges([
  f(4,"Protección Solar","PARAFARMACIA",{referencePharmacy:"ALMACEN",para:80}),
  f(5,"Proteccion Solar","SIN_DETERMINAR",{para:34,med:1}),
  f(6,"Proteccion Solar","SIN_DETERMINAR",{para:10,med:20}),
  f(7,"Proteccion Solar","SIN_DETERMINAR",{linked:0,para:0,med:0})
 ]);
 assert.equal(data.actions.length,1);
 assert.equal(data.actions[0].sourceId,"5");
 assert.equal(data.actions[0].destinationId,"4");
 assert.equal(data.actions[0].reason,"mismo_nombre_segmento_validado_cn");
 assert.equal(data.ambiguousCrossSegment,2);
});
test("categorías administrativas no se fusionan por etiqueta repetida",()=>{
 const data=planSameNameMerges([
  f(1,"Otros"),f(2,"OTROS"),f(3,"Sin Categoria"),f(4,"Sin categoría"),
  f(5,"A Revisar"),f(6,"A REVISAR"),f(7,"Especialidades"),f(8,"especialidades")
 ]);
 assert.equal(data.actions.length,0);
});
test("nombres personalizados prevalecen como destino salvo referencia consolidada",()=>{
 const data=planSameNameMerges([
  f(1,"Homeopatia","SIN_DETERMINAR",{linked:10}),
  f(2,"Homeopatía","SIN_DETERMINAR",{customName:true,linked:5}),
  f(3,"HOMEOPATÍA","SIN_DETERMINAR",{linked:17})
 ]);
 assert.equal(data.actions.length,2);
 assert.ok(data.actions.every(x=>x.destinationId==="2"));
 assert.equal(data.groups[0].name,"Homeopatía");
});
test("no confunde ñ y n; ni vuelve a fusionar filas inactivas",()=>{
 assert.notEqual(normalizedFamilyLabel("Año escolar"),normalizedFamilyLabel("Ano escolar"));
 assert.equal(planSameNameMerges([
  f(1,"Bebé"),f(2,"Bebe",{...{}},"unused"),
  f(3,"Bebé","SIN_DETERMINAR",{active:false})
 ]).actions.length,0);
});
