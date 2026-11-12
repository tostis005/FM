import test from "node:test";
import assert from "node:assert/strict";
import {defaultLaboratoryLine,mergeVisibleOrderLines,orderLineFor,
 laboratoryExcelRows,laboratoryOrderListRows,laboratoryExportName,
 medicationOrderTotal,distributeMedicationOrderTotal,totalStockFor,laboratoryStockTotals,
 laboratoryOrderSortValue,compareLaboratoryOrderRows,laboratoryOrderGroupValue,compareLaboratoryOrderGroups} from "./laboratoryOrderSheet.js";
import {groupedLaboratoryRows} from "./laboratoryOrderGrouping.js";
const pharmacies=[{id:"1",name:"Central"},{id:"2",name:"Norte"}];
const row={referencia:"000123",cn:"000123",nombre:"Crema solar",
 byPharmacy:{"1":{stock:4,units3:33,units12:110,unitsPeriod:8,suggested:10},
  "2":{stock:3,units3:20,units12:70,unitsPeriod:6,suggested:7}}};
test("parafarmacia suma la propuesta en un único campo editable",()=>{
 const line=defaultLaboratoryLine(row,"parafarmacia",["1","2"]);
 assert.equal(line.units,17);
 assert.equal(line.metrics["1"].stock,4);
 const data=laboratoryExcelRows([{row,line}],pharmacies,"parafarmacia");
 assert.equal(data[0].length,2+5*2+10);
 assert.equal(data[1].at(-2),"Pedir total");
  assert.equal(data[1].at(-1),"Comentarios");
 assert.equal(data[0].at(-2),"Pedir total");
 assert.deepEqual(data[2].slice(-5),[7,null,17,17,""]);
 assert.equal(data[2][0],"000123");
});
test("medicación nunca mezcla cantidades entre farmacias",()=>{
 const line=defaultLaboratoryLine({...row,cn:"400123",referencia:"400123"},"medicacion",["1","2"]);
 assert.deepEqual(line.unitsByPharmacy,{"1":10,"2":7});
 line.unitsByPharmacy["1"]=4;
 const data=laboratoryExcelRows([{row:{...row,cn:"400123"},line}],pharmacies,"medicacion");
 assert.equal(data[0].length,2+5*2+10);
 assert.equal(data[2][6],4);
 assert.equal(data[2][11],7);
 assert.deepEqual(data[2].slice(-5),[7,null,17,11,""]);
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
 assert.deepEqual(sheet[0],["Cliente","Código nacional / EAN","Artículo","Unidades","Comentarios"]);
 assert.deepEqual(sheet[1],["Pedia","000123","Crema solar",18,""]);
});
test("Medicación exporta unidades por cada farmacia, sin confundirlas con propuesta",()=>{
 const line=defaultLaboratoryLine({...row,cn:"400123"},"medicacion",["1","2"]);
 line.unitsByPharmacy={"1":3,"2":6};
 const sheet=laboratoryOrderListRows([{row:{...row,cn:"400123"},line}],pharmacies,"medicacion");
 assert.deepEqual(sheet[0],["Código nacional / EAN","Artículo","Pedir Central","Pedir Norte","Total pedir","Comentarios"]);
 assert.deepEqual(sheet[1],["400123","Crema solar",3,6,9,""]);
});

test("medicación: editar el total redistribuye sin perder las farmacias",()=>{
 const line=defaultLaboratoryLine({...row,cn:"400123"},"medicacion",["1","2"]);
 assert.equal(medicationOrderTotal(line,["1","2"]),17);
 const edited=distributeMedicationOrderTotal(row,line,["1","2"],34);
 assert.deepEqual(edited.unitsByPharmacy,{"1":20,"2":14});
 assert.equal(medicationOrderTotal(edited,["1","2"]),34);
 assert.deepEqual(line.unitsByPharmacy,{"1":10,"2":7},"No modifica el borrador anterior");
 const workbook=laboratoryExcelRows([{row,line:edited}],pharmacies,"medicacion");
 assert.equal(workbook[2].at(-2),34);
 const order=laboratoryOrderListRows([{row,line:edited}],pharmacies,"medicacion");
 assert.deepEqual(order[1].slice(-4),[20,14,34,""]);
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

test("el Excel incluye stock total, comentarios de línea y generales en las dos hojas",()=>{
 const line={...defaultLaboratoryLine(row,"parafarmacia",["1","2"]),units:5,comment:"Enviar muestra"};
 const detail=laboratoryExcelRows([{row,line}],pharmacies,"parafarmacia","Entrega urgente");
 const order=laboratoryOrderListRows([{row,line}],pharmacies,"parafarmacia","Entrega urgente");
 assert.deepEqual(detail[1].slice(2,5),["Stock","Ventas 12m","Ventas 3m"]);
 assert.equal(detail[2][2],4);
 assert.equal(detail[2][7],3);
 assert.equal(detail[2].at(-1),"Enviar muestra");
 assert.equal(order[1].at(-1),"Enviar muestra");
 assert.deepEqual(detail.at(-1).slice(0,2),["Comentarios generales del pedido","Entrega urgente"]);
 assert.deepEqual(order.at(-1).slice(0,2),["Comentarios generales del pedido","Entrega urgente"]);
});
test("las bajas conservan cantidades, comentarios y CN por separado",()=>{
 const excluded={...row,excluded:true};
 const first=defaultLaboratoryLine(excluded,"parafarmacia",["1","2"]);
 assert.equal(first.units,17);
 const draft={"000123":{...first,units:25,comment:"Referencia descatalogada"}};
 const line=orderLineFor(excluded,"parafarmacia",["1","2"],draft);
 assert.equal(line.units,25);
 assert.equal(line.comment,"Referencia descatalogada");
 assert.equal(mergeVisibleOrderLines([excluded],"parafarmacia",["1","2"],draft)["000123"].units,25);
 const medication=defaultLaboratoryLine({...excluded,cn:"400123"},"medicacion",["1","2"]);
 assert.deepEqual(medication.unitsByPharmacy,{"1":10,"2":7});
 assert.equal(totalStockFor({...row,byPharmacy:{"1":{stock:4},"2":{stock:null}}},["1","2"]),4);
});

test("el Excel incluye bloque Almacén y totales compactos sin duplicar stock",()=>{
 const item={...row,totalSuggested:0,warehouseStock:1000,globalStock:1007,
  warehouse:{stock:1000,units12:0,units3:0,unitsPeriod:0,suggested:null}};
 const line=defaultLaboratoryLine(item,"parafarmacia",["1","2"]);
 assert.equal(line.units,0);
 const excel=laboratoryExcelRows([{row:item,line}],pharmacies,"parafarmacia");
 assert.equal(excel[0].length,22);
 assert.deepEqual(excel[1].slice(-10),[
  "Stock","Ventas 12m","Ventas 3m","Vendido período","Propuesta",
  "Total farm.","Total + ALM","Propuesta","Pedir total","Comentarios"]);
 assert.deepEqual(excel[2].slice(-10),[1000,0,0,0,null,7,1007,0,0,""]);
 const med=defaultLaboratoryLine({...item,cn:"400123"},"medicacion",["1","2"]);
 assert.deepEqual(med.unitsByPharmacy,{"1":10,"2":7});
 const medication=laboratoryExcelRows([{row:{...item,cn:"400123"},line:med}],pharmacies,"medicacion");
 assert.deepEqual(medication[2].slice(-10),[null,null,null,null,null,7,null,0,17,""]);
});


test("los cuatro totales ordenan numéricamente en ascendente y descendente",()=>{
 const one={...row,metricsReady:true,globalStock:12,totalSold:9,totalSuggested:8};
 const two={...row,referencia:"000124",cn:"000124",metricsReady:true,globalStock:101,totalSold:100,totalSuggested:20};
 const missing={...row,referencia:"000125",cn:"000125",metricsReady:true,
  globalStock:null,totalSold:null,totalSuggested:null,
  byPharmacy:{"1":{stock:null},"2":{stock:3}}};
 assert.equal(laboratoryOrderSortValue(one,"totalStock","parafarmacia",["1","2"]),12);
 assert.equal(laboratoryOrderSortValue(one,"totalStock","medicacion",["1","2"]),7,
  "Medicación ignora el almacén");
 for(const field of ["totalStock","totalUnits","totalSuggested"]){
  assert.ok(compareLaboratoryOrderRows(two,one,field+":desc","parafarmacia",["1","2"])<0);
  assert.ok(compareLaboratoryOrderRows(one,two,field+":asc","parafarmacia",["1","2"])<0);
  assert.ok(compareLaboratoryOrderRows(one,missing,field+":desc","parafarmacia",["1","2"])<0,
   "El dato desconocido queda al final");
  assert.ok(field==="totalStock"?
   compareLaboratoryOrderRows(one,missing,field+":asc","parafarmacia",["1","2"])>0:
   compareLaboratoryOrderRows(one,missing,field+":asc","parafarmacia",["1","2"])<0,
   "Stock NULL ahora es cero y se ordena como 0; ventas y propuestas NULL siguen sin datos");
 }
 assert.equal(laboratoryOrderSortValue({...one,metricsReady:false},"totalStock","parafarmacia",["1","2"]),null);
});

test("Pedir total ordena la cantidad editada, no la propuesta ni el texto del input",()=>{
 const first={...row,metricsReady:true,totalSuggested:4};
 const second={...row,referencia:"000124",cn:"000124",metricsReady:true,totalSuggested:40};
 const drafts={
  [first.referencia]:{...defaultLaboratoryLine(first,"parafarmacia",["1","2"]),units:75},
  [second.referencia]:{...defaultLaboratoryLine(second,"parafarmacia",["1","2"]),units:2}
 };
 assert.equal(laboratoryOrderSortValue(first,"totalOrder","parafarmacia",["1","2"],drafts),75);
 assert.ok(compareLaboratoryOrderRows(first,second,"totalOrder:desc","parafarmacia",["1","2"],drafts)<0);
 assert.ok(compareLaboratoryOrderRows(first,second,"totalOrder:asc","parafarmacia",["1","2"],drafts)>0);
 const medication={
  [first.referencia]:{unitsByPharmacy:{"1":3,"2":4}},
  [second.referencia]:{unitsByPharmacy:{"1":20,"2":12}}
 };
 assert.equal(laboratoryOrderSortValue(first,"totalOrder","medicacion",["1","2"],medication),7);
 assert.ok(compareLaboratoryOrderRows(second,first,"totalOrder:desc","medicacion",["1","2"],medication)<0);
});

test("R1, R2 y dúplos suman Pedir total como UN grupo, preservando cada CN",()=>{
 const items=[
  {referencia:"234567",cn:"234567",nombre:"Crema Solar SPF 50",metricsReady:true,totalSold:4,
   byPharmacy:{"1":{stock:2,suggested:2},"2":{stock:0,suggested:0}}},
  {referencia:"111111",cn:"111111",nombre:"Crema Solar SPF 50 R2 234567",metricsReady:true,totalSold:7,
   byPharmacy:{"1":{stock:0,suggested:5},"2":{stock:0,suggested:1}}},
  {referencia:"888888",cn:"888888",nombre:"Crema Solar SPF 50 DUPLO 2",metricsReady:true,totalSold:3,
   byPharmacy:{"1":{stock:0,suggested:2},"2":{stock:0,suggested:2}}},
  {referencia:"999999",cn:"999999",nombre:"Otra loción",metricsReady:true,totalSold:10,
   byPharmacy:{"1":{stock:3,suggested:10},"2":{stock:0,suggested:0}}}
 ];
 const drafts={
  "234567":{units:5},
  "111111":{units:8},
  "888888":{units:10},
  "999999":{units:20}
 };
 const groups=groupedLaboratoryRows(items);
 const family=groups.find(g=>g.rows.length===3);
 assert.deepEqual(family.rows.map(r=>r.cn),["234567","111111","888888"]);
 assert.equal(laboratoryOrderGroupValue(family,"totalOrder","parafarmacia",["1","2"],drafts),23,
  "5 + 8 + 10 = 23, y no solo 5 del artículo principal");
 const sort="totalOrder:desc";
 const sorted=groupedLaboratoryRows(items,sort,(a,b)=>
  compareLaboratoryOrderGroups(a,b,sort,"parafarmacia",["1","2"],drafts));
 assert.equal(sorted[0].rows.length,3,"La familia supera a la referencia independiente de 20 uds");
 assert.deepEqual(sorted[0].rows.map(r=>r.cn),["234567","111111","888888"]);
 assert.equal(sorted[1].rows[0].cn,"999999");
 const changed={...drafts,"111111":{units:1}};
 assert.equal(laboratoryOrderGroupValue(family,"totalOrder","parafarmacia",["1","2"],changed),16);
 const reordered=groupedLaboratoryRows(items,sort,(a,b)=>
  compareLaboratoryOrderGroups(a,b,sort,"parafarmacia",["1","2"],changed));
 assert.equal(reordered[0].representative.cn,"999999","Se reordena por la suma editada");
 assert.equal(Object.values(drafts).reduce((sum,line)=>sum+line.units,0),43,
  "La suma global incluye cada CN una vez, sin sumar además el grupo");
});

test("Pedir total agrupado en medicación suma todas las farmacias de cada CN",()=>{
 const items=[
  {referencia:"234567",cn:"234567",nombre:"Crema Solar SPF 50",metricsReady:true},
  {referencia:"111111",cn:"111111",nombre:"Crema Solar SPF 50 R1 234567",metricsReady:true}
 ];
 const family=groupedLaboratoryRows(items)[0];
 const drafts={
  "234567":{unitsByPharmacy:{"1":2,"2":3}},
  "111111":{unitsByPharmacy:{"1":4,"2":5}}
 };
 assert.equal(laboratoryOrderGroupValue(family,"totalOrder","medicacion",["1","2"],drafts),14);
 assert.deepEqual(items.map(item=>item.referencia),["234567","111111"]);
});

test("los grupos sin métricas completas se ordenan al final, no como 0",()=>{
 const rows=[
  {referencia:"234567",cn:"234567",nombre:"Crema Solar SPF 50",metricsReady:true,globalStock:10},
  {referencia:"111111",cn:"111111",nombre:"Crema Solar SPF 50 R1 234567",metricsReady:false},
  {referencia:"999999",cn:"999999",nombre:"Otra loción",metricsReady:true,globalStock:5}
 ];
 const groups=groupedLaboratoryRows(rows);
 const family=groups.find(g=>g.rows.length===2);
 assert.equal(laboratoryOrderGroupValue(family,"totalStock","parafarmacia",["1","2"]),null);
 const sorted=groupedLaboratoryRows(rows,"totalStock:desc",(a,b)=>
  compareLaboratoryOrderGroups(a,b,"totalStock:desc","parafarmacia",["1","2"]));
 assert.equal(sorted[0].representative.cn,"999999");
 assert.equal(sorted[1].representative.cn,"234567");
});

test("Cinfa parafarmacia: NULL o artículo ausente cuentan 0, sin parcial",()=>{
 const rows=[
  {metricsReady:true,byPharmacy:{"1":{stock:4},"2":{stock:3}},
   warehouseReady:true,warehouse:{stock:2},globalStock:9},
  {metricsReady:true,byPharmacy:{"1":{stock:0,stockInferredZero:true},"2":{stock:null}},
   warehouseReady:false,warehouse:{stock:null},globalStock:null}
 ];
 const para=laboratoryStockTotals(rows,[1,2],true);
 assert.deepEqual(para,{pharmacyStock:7,globalStock:9});
 const med=laboratoryStockTotals(rows,[1,2],false);
 assert.deepEqual(med,{pharmacyStock:7,globalStock:7});
 assert.equal(totalStockFor(rows[1],[1,2]),0);
});

test("sin existencia informada el resultado real cero es válido",()=>{
 const rows=[{metricsReady:true,byPharmacy:{"1":{stock:0},"2":{stock:0}},
  warehouseReady:true,warehouse:{stock:0}}];
 assert.deepEqual(laboratoryStockTotals(rows,[1,2],true),
  {pharmacyStock:0,globalStock:0});
 assert.deepEqual(laboratoryStockTotals([{metricsReady:true,byPharmacy:{},warehouse:{}}],
  [1,2],true),{pharmacyStock:0,globalStock:0});
});

test("sin métricas terminadas, un error de carga no se convierte en existencias 0",()=>{
 const rows=[{metricsReady:true,byPharmacy:{"1":{stock:5}}},{metricsReady:false}];
 assert.deepEqual(laboratoryStockTotals(rows,[1],true),
  {pharmacyStock:null,globalStock:null});
});
