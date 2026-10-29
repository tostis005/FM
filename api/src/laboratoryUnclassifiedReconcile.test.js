import test from "node:test";
import assert from "node:assert/strict";
import {planUnclassifiedLaboratoryAliases} from "./laboratoryUnclassifiedReconcile.js";
const rows=[
 {id:"1",name:"ABBOTT LABORATORIES",class:"DIRECTO",active:true},
 {id:"2",name:"ABBOTT LABORATORIES, SA",class:"SIN_CLASIFICAR",active:true},
 {id:"3",name:"ABOCA",class:"DIRECTO",active:true},
 {id:"4",name:"ABOCA ESPAÑA S.A.U.",class:"SIN_CLASIFICAR",active:true},
 {id:"5",name:"ALCAMPO SAU",class:"DIRECTO",active:true},
 {id:"6",name:"ALCAMPO",class:"SIN_CLASIFICAR",active:true},
 {id:"7",name:"ALLERGY THERAPEUTICS IBERICA",class:"DIRECTO",active:true},
 {id:"8",name:"ALLERGY THERAPEUTICS IBERICA",class:"VACUNAS",active:true},
 {id:"9",name:"ALLERGY THERAPEUTICS IBERICA",class:"SIN_CLASIFICAR",active:true},
 {id:"10",name:"REIG JOFRE",class:"DIRECTO",active:true},
 {id:"11",name:"ORRAVAN REIG JOFRE",class:"SIN_CLASIFICAR",active:true},
];
const aliases=[
 {supplier:"1",pharmacyCode:"ABA",sourceCode:"75"},
 {supplier:"2",pharmacyCode:"VAL",sourceCode:"0075"},
 {supplier:"3",pharmacyCode:"ABA",sourceCode:"235"},
 {supplier:"4",pharmacyCode:"VAL",sourceCode:"235"},
 {supplier:"5",pharmacyCode:"ABA",sourceCode:"17"},
 {supplier:"6",pharmacyCode:"VAL",sourceCode:"17"},
 {supplier:"7",pharmacyCode:"LUZ",sourceCode:"346"},
 {supplier:"8",pharmacyCode:"AMP",sourceCode:"4026"},
 {supplier:"9",pharmacyCode:"EST",sourceCode:"4026"},
 {supplier:"10",pharmacyCode:"ABA",sourceCode:"222"},
 {supplier:"11",pharmacyCode:"VAL",sourceCode:"333"}
];
test("asocia códigos sin clasificar por identidad y CN real, no servicios",()=>{
 const p=planUnclassifiedLaboratoryAliases(rows,aliases,new Set(["1","3","7","8","10"]));
 assert.deepEqual(p.operations.map(o=>[o.from,o.to]),[["2","1"],["4","3"],["9","8"]]);
 assert.equal(p.operations.every(o=>o.kind==="SIN_CLASIFICAR"),true);
 assert.equal(p.status.merged,3);
});
test("no modifica manuales, pedidos previos, códigos distintos de la misma farmacia",()=>{
 const p=planUnclassifiedLaboratoryAliases(rows,aliases,new Set(["1","3","8"]),new Set(["2"]));
 assert.ok(!p.operations.some(o=>o.from==="2"));
 assert.ok(p.status.manualOrHistory>=1);
 const moved=aliases.map(a=>a.supplier==="4"?{...a,pharmacyCode:"ABA"}:a);
 const q=planUnclassifiedLaboratoryAliases(rows,moved,new Set(["1","3","8"]));
 assert.ok(!q.operations.some(o=>o.from==="4"));
 assert.equal(q.status.pharmacyConflict,1);
});
test("si hay dos destinos idénticos, no se escoge uno por número",()=>{
 const p=planUnclassifiedLaboratoryAliases(rows,aliases,new Set(["7","8"]));
 assert.equal(p.operations.length,1); // La prueba del código distingue VACUNAS.
 const q=planUnclassifiedLaboratoryAliases(rows,
  aliases.filter(x=>x.supplier!=="9").concat([{supplier:"9",pharmacyCode:"EST",sourceCode:"777"}]),
  new Set(["7","8"]));
 assert.equal(q.operations.length,0);
 assert.equal(q.status.ambiguous,1);
});
