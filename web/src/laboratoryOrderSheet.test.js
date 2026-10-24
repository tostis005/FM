import test from "node:test";
import assert from "node:assert/strict";
import {defaultLaboratoryLine,mergeVisibleOrderLines,orderLineFor,
 laboratoryExcelRows,laboratoryExportName} from "./laboratoryOrderSheet.js";
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
 assert.deepEqual(data[2].slice(-3),[14,17,17]);
 assert.equal(data[2][0],"000123");
});
test("medicación nunca mezcla cantidades entre farmacias",()=>{
 const line=defaultLaboratoryLine({...row,cn:"400123",referencia:"400123"},"medicacion",["1","2"]);
 assert.deepEqual(line.unitsByPharmacy,{"1":10,"2":7});
 line.unitsByPharmacy["1"]=4;
 const data=laboratoryExcelRows([{row:{...row,cn:"400123"},line}],pharmacies,"medicacion");
 assert.equal(data[0].length,2+5*2+2);
 assert.equal(data[2][6],4);
 assert.equal(data[2][11],7);
 assert.deepEqual(data[2].slice(-2),[14,17]);
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
