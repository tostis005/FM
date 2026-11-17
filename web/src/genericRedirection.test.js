import test from "node:test";
import assert from "node:assert/strict";
import {restoreGenericGoal,proposeGenericOrder,genericOrderRows} from "./genericRedirection.js";
import {offerSaving} from "./genericSavingsView.js";

const pharmacies=[{id:1,name:"Centro"},{id:2,name:"Norte"}];
test("objetivo guardado por genérico es un único destino y cuota",()=>{
 const a=restoreGenericGoal([{laboratory:"CINFA",cn:"1",percent:50}],
  [{name:"CINFA"},{name:"NORMON"}]);
 assert.deepEqual(a,{laboratory:"CINFA",percent:50,cn:"1",legacyMultiple:false});
 assert.deepEqual(restoreGenericGoal([],[{name:"CINFA"}]),{
  laboratory:"",percent:80,cn:"",legacyMultiple:false
 });
});
test("objetivos antiguos con varios laboratorios se migran de forma explícita",()=>{
 const saved=restoreGenericGoal([
  {laboratory:"CINFA",cn:"1",percent:20},
  {laboratory:"NORMON",cn:"2",percent:50},
  {laboratory:"INEXISTENTE",cn:"3",percent:30}
 ],[{name:"CINFA"},{name:"NORMON"}]);
 assert.equal(saved.laboratory,"NORMON");
 assert.equal(saved.percent,50);
 assert.equal(saved.legacyMultiple,true);
});
test("50 a 40 % recalcula propuesta y ahorro, sin crear pedidos manuales",()=>{
 const history={salesAvailable:true,purchasesAvailable:true,pharmacies:[
  {pharmacyId:"1",salesUnits:60,referencePuc:1.6},
  {pharmacyId:"2",salesUnits:40,referencePuc:1.6}
 ]};
 const offer={net:.9,puc:.936};
 const first=proposeGenericOrder(100,50,pharmacies,history.pharmacies);
 const second=proposeGenericOrder(100,40,pharmacies,history.pharmacies);
 assert.equal(first.units,50);
 assert.deepEqual(first.distribution,{"1":30,"2":20});
 assert.equal(second.units,40);
 assert.deepEqual(second.distribution,{"1":24,"2":16});
 assert.equal(first.unassigned,50);
 assert.equal(second.unassigned,60);
 assert.equal(offerSaving(history,offer,50),35);
 assert.equal(offerSaving(history,offer,40),28);
 const labs=[{name:"NORMON",selected:{puc:.936}},
  {name:"CINFA",selected:{puc:1.248}}];
 const manual={"NORMON":{"1":8,"2":2},"CINFA":{"1":4}};
 assert.deepEqual(genericOrderRows(labs,pharmacies,manual).map(r=>r.units),[10,4]);
 assert.deepEqual(genericOrderRows(labs,pharmacies,manual).map(r=>r.units),[10,4],
  "Variar el objetivo no modifica las unidades elegidas manualmente");
});
test("sin histórico se reparte la propuesta por igual sin inventar ventas",()=>{
 const p=proposeGenericOrder(9,50,pharmacies,[]);
 assert.equal(p.units,5);
 assert.deepEqual(p.distribution,{"1":3,"2":2});
 assert.equal(p.source,"equal");
 assert.equal(proposeGenericOrder("",50,pharmacies,[]).available,false);
 assert.equal(proposeGenericOrder(100,50,[],[]).available,false);
 assert.match(proposeGenericOrder("100.4",50,pharmacies,[]).error,/entero/);
});
