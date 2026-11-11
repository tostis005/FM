import test from "node:test";
import assert from "node:assert/strict";
import {buildGlobalTransfers,parseTransferFilters,filterTransferPlan} from "./transferidor.js";

const pharmacies=[{id:"1",name:"Abadía"},{id:"2",name:"Europa"},{id:"3",name:"Centro"},{id:"4",name:"Norte"}];
const item=(pharmacyId,cn,stock,target)=>({
 pharmacyId,cn,name:"Parafarmacia",stock,units3:0,units12:target*365/20,ordered:0
});

test("redistribuye globalmente un CN sin asignar dos veces las mismas unidades",()=>{
 const result=buildGlobalTransfers([
  item("1","123456",2,5),item("2","123456",8,2),
  item("3","123456",1,4),item("4","123456",0,0)
 ],pharmacies,20);
 assert.equal(result.transfers.reduce((n,t)=>n+t.units,0),6);
 assert.deepEqual(result.transfers.map(t=>[t.originId,t.destinationId,t.units]),
  [["2","1",3],["2","3",3]]);
 assert.ok(result.transfers.every(t=>t.originId!==t.destinationId));
 assert.equal(result.skipped,0);
});

test("medicación queda fuera y un artículo sin stock fiable nunca se reparte",()=>{
 const result=buildGlobalTransfers([
  item("1","500001",10,0),item("2","500001",0,9),
  item("1","123457",null,2),item("2","123457",10,0),
  item("1","123458",6.5,0),item("2","123458",0,4)
 ],pharmacies.slice(0,2),20);
 assert.deepEqual(result.transfers.map(x=>x.cn),["123458"]);
 assert.equal(result.transfers[0].units,4);
 assert.equal(result.skipped,1);
});

test("filtra todos, envío, recepción y farmacia de origen/destino sobre plan global",()=>{
 const plan=buildGlobalTransfers([
  item("1","123456",1,5),item("2","123456",12,1),item("3","123456",0,5)
 ],pharmacies.slice(0,3),20).transfers;
 const opts=raw=>parseTransferFilters({pagina:1,tamano:10,...raw},pharmacies.slice(0,3));
 assert.equal(filterTransferPlan(plan,opts({vista:"recibo",farmacia:"3"})).total,1);
 assert.equal(filterTransferPlan(plan,opts({vista:"envio",farmacia:"1"})).total,0);
 assert.equal(filterTransferPlan(plan,opts({origen:"2",destino:"1"})).total,1);
 assert.equal(filterTransferPlan(plan,opts({vista:"todos",farmacia:"2"})).total,2);
 assert.throws(()=>opts({origen:"9"}),/filtros|farmacia/);
 assert.throws(()=>opts({filtros:'{"__proto__":"x"}'}),/filtros|farmacia/);
});
