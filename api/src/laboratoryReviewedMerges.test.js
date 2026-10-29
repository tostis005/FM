import test from "node:test";
import assert from "node:assert/strict";
import {REVIEWED_LAB_PAIRS,reviewedLaboratoryMerges} from "./laboratoryReviewedMerges.js";
const build=()=>{
 const master=REVIEWED_LAB_PAIRS.flatMap(p=>[
  {id:p.from,name:p.fromName,class:"DIRECTO",active:true},
  {id:p.to,name:p.toName,class:"DIRECTO",active:true}]);
 const aliases=REVIEWED_LAB_PAIRS.flatMap((p,i)=>[
  {supplier:p.from,pharmacyCode:"ABA",sourceCode:String(i)},
  {supplier:p.to,pharmacyCode:"EUR",sourceCode:String(i)}]);
 return {master,aliases};
};
test("solo se aplican las cuatro equivalencias revisadas",()=>{
 const {master,aliases}=build(),result=reviewedLaboratoryMerges(master,aliases);
 assert.equal(result.operations.length,4);
 assert.deepEqual(result.operations.map(p=>[p.from,p.to]),REVIEWED_LAB_PAIRS.map(p=>[p.from,p.to]));
});
test("si cambió el maestro se rechaza toda la operación",()=>{
 const {master,aliases}=build();master[0].name="EMPRESA DISTINTA";
 assert.throws(()=>reviewedLaboratoryMerges(master,aliases),/cambió/);
});
test("no afecta a relaciones manuales, fechas ni proveedores coexistentes en una farmacia",()=>{
 const {master,aliases}=build();
 assert.throws(()=>reviewedLaboratoryMerges(master,aliases,new Set(["545"])),/manuales/);
 assert.throws(()=>reviewedLaboratoryMerges(master,aliases,new Set(),new Set(["308"])),/planificados/);
 aliases[1].pharmacyCode="ABA";
 assert.throws(()=>reviewedLaboratoryMerges(master,aliases),/misma farmacia/);
});
