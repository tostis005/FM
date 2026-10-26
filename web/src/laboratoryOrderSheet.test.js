import test from "node:test";
import assert from "node:assert/strict";
import {defaultLaboratoryLine,mergeVisibleOrderLines,orderLineFor,
 laboratoryExcelRows,laboratoryOrderListRows,laboratoryExportName,
 medicationOrderTotal,distributeMedicationOrderTotal} from "./laboratoryOrderSheet.js";
const pharmacies=[{id:"1",name:"Central"},{id:"2",name:"Norte"}];
const row={referencia:"000123",cn:"000123",nombre:"Crema solar",
 byPharmacy:{"1":{stock:4,units3:33,units12:110,unitsPeriod:8,suggested:10},
  "2":{stock:3,units3:20,units12:70,unitsPeriod:6,suggested:7}}};
test("parafarmacia suma la propuesta en un único campo editable",()=>{
 const line=defaultLaboratoryLine(row,"parafarmacia",["1","2"]);
 assert.equal(line.units,17);
 assert.equal(line.metrics["1"].stock,4);
 const data=laboratoryExcelRows([{row,line}],pharmacies,"parafarmacia");
 assert.equal(data[0].length,2+5*2+3);
 assert.equal(data[1].at(-1),"Pedir total");
 assert.equal(data[0].at(-1),"Pedir total");
 assert.deepEqual(data[2].slice(-3),[14,17,17]);
 assert.equal(data[2][0],"000123");
});
test("medicación nunca mezcla cantidades entre farmacias",()=>{
 const line=defaultLaboratoryLine({...row,cn:"400123",referencia:"400123"},"medicacion",["1","2"]);
 assert.deepEqual(line.unitsByPharmacy,{"1":10,"2":7});
 line.unitsByPharmacy["1"]=4;
 const data=laboratoryExcelRows([{row:{...row,cn:"400123"},line}],pharmacies,"medicacion");
 assert.equal(data[0].length,2+5*2+3);
 assert.equal(data[2][6],4);
 assert.equal(data[2][11],7);
 assert.deepEqual(data[2].slice(-3),[14,17,11]);
});
test("borrador conserva ediciones previas al cambiar de página",()=>{
 const edited={"000123":{...defaultLaboratoryLine(row,"parafarmacia",["1","2"]),units:12}};
 const other={...row,referencia:"000124",cn:"000124",nombre:"Otra crema"};
 const merged=mergeVisibleOrderLines([other],"parafarmacia",["1","2"],edited);
 assert.equal(merged["000123"].units,12);
 assert.equal(merged["000124"].units,17);
 assert.equal(orderLineFor(row,"parafarmacia",["1","2"],merged).units,12);
 assert.match(laboratoryExportName("Laboratorio Álvarez / SL","medicacion"),/pedido-Laboratorio-Alvarez-SL-medicacion\.xlsx/);
});

test("Pedia recibe un solo pedido con cantidades conjuntas de parafarmacia",()=>{
 const line=defaultLaboratoryLine(row,"parafarmacia",["1","2"]);
 line.units=18;
 const sheet=laboratoryOrderListRows([{row,line}],pharmacies,"parafarmacia");
 assert.deepEqual(sheet[0],["Cliente","Código nacional / EAN","Artículo","Unidades"]);
 assert.deepEqual(sheet[1],["Pedia","000123","Crema solar",18]);
});
test("Medicación exporta unidades por cada farmacia, sin confundirlas con propuesta",()=>{
 const line=defaultLaboratoryLine({...row,cn:"400123"},"medicacion",["1","2"]);
 line.unitsByPharmacy={"1":3,"2":6};
 const sheet=laboratoryOrderListRows([{row:{...row,cn:"400123"},line}],pharmacies,"medicacion");
 assert.deepEqual(sheet[0],["Código nacional / EAN","Artículo","Pedir Central","Pedir Norte","Total pedir"]);
 assert.deepEqual(sheet[1],["400123","Crema solar",3,6,9]);
});

test("medicación: editar el total redistribuye sin perder las farmacias",()=>{
 const line=defaultLaboratoryLine({...row,cn:"400123"},"medicacion",["1","2"]);
 assert.equal(medicationOrderTotal(line,["1","2"]),17);
 const edited=distributeMedicationOrderTotal(row,line,["1","2"],34);
 assert.deepEqual(edited.unitsByPharmacy,{"1":20,"2":14});
 assert.equal(medicationOrderTotal(edited,["1","2"]),34);
 assert.deepEqual(line.unitsByPharmacy,{"1":10,"2":7},"No modifica el borrador anterior");
 const workbook=laboratoryExcelRows([{row,line:edited}],pharmacies,"medicacion");
 assert.equal(workbook[2].at(-1),34);
 const order=laboratoryOrderListRows([{row,line:edited}],pharmacies,"medicacion");
 assert.deepEqual(order[1].slice(-3),[20,14,34]);
});
test("medicación: respeta reparto actual, redondea y permite cero",()=>{
 const line={unitsByPharmacy:{"1":4,"2":7}};
 const increased=distributeMedicationOrderTotal(row,line,["1","2"],22);
 assert.deepEqual(increased.unitsByPharmacy,{"1":8,"2":14});
 assert.deepEqual(distributeMedicationOrderTotal(row,line,["1","2"],5).unitsByPharmacy,
  {"1":2,"2":3});
 const zero=distributeMedicationOrderTotal(row,line,["1","2"],0);
 assert.deepEqual(zero.unitsByPharmacy,{"1":0,"2":0});
 assert.deepEqual(distributeMedicationOrderTotal(row,zero,["1","2"],9).unitsByPharmacy,
  {"1":5,"2":4},"Desde cero utiliza las propuestas como pesos");
});
test("medicación: sin venta ni propuesta reparte de forma estable entre farmacias",()=>{
 const noDemand={referencia:"3",byPharmacy:{"1":{suggested:0},"2":{suggested:0}}};
 const draft={unitsByPharmacy:{"1":0,"2":0}};
 assert.deepEqual(distributeMedicationOrderTotal(noDemand,draft,["1","2"],5).unitsByPharmacy,
  {"1":3,"2":2});
 assert.equal(distributeMedicationOrderTotal(noDemand,draft,["1","2"],-1),null);
 assert.equal(distributeMedicationOrderTotal(noDemand,draft,["1","2"],1.5),null);
 assert.equal(distributeMedicationOrderTotal(noDemand,draft,["1","2"],1000000),null);
 assert.equal(distributeMedicationOrderTotal(noDemand,draft,[],4),null);
});
