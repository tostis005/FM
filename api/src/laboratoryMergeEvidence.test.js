import test from "node:test";
import assert from "node:assert/strict";
import {proposeEvidenceLaboratoryMerges} from "./laboratoryMergeEvidence.js";
const providers=[
 {id:"1",name:"LABORATORIOS CINFA, S.A.",class:"DIRECTO",active:true},
 {id:"2",name:"Cinfa SA",class:"DIRECTO",active:true},
 {id:"3",name:"CINFA",class:"MAYORISTA",active:true},
 {id:"4",name:"CINFA",class:"INTERNO",active:true},
 {id:"5",name:"CINFA",class:"DIRECTO",active:true},
 {id:"6",name:"LABORATORIO BAYER",class:"DIRECTO",active:true},
 {id:"7",name:"BAYER SA",class:"DIRECTO",active:true}
];
const aliases=[
 {supplier:"1",sourceCode:"0200",pharmacyCode:"ABA"},
 {supplier:"2",sourceCode:"200",pharmacyCode:"EUR"},
 {supplier:"3",sourceCode:"200",pharmacyCode:"EST"},
 {supplier:"4",sourceCode:"200",pharmacyCode:"POL"},
 {supplier:"5",sourceCode:"900",pharmacyCode:"BUE"},
 {supplier:"6",sourceCode:"BAYER2",pharmacyCode:"ABA"},
 {supplier:"7",sourceCode:"BAYER9",pharmacyCode:"EUR"}
];
test("fusionar solo nombres equivalentes con código compartido entre farmacias",()=>{
 const x=proposeEvidenceLaboratoryMerges(providers,aliases);
 assert.deepEqual(x.operations.map(r=>[r.from,r.to,r.matchingCodes]),[["2","1",["200"]]]);
 assert.ok(x.review.some(x=>x.from==="5"&&x.reason==="sin_codigo_compartido"));
 assert.ok(x.review.some(x=>x.from==="7"&&x.reason==="sin_codigo_compartido"));
 assert.ok(!x.operations.some(x=>["3","4"].includes(x.from)));
});
test("las asociaciones manuales y los pedidos previos impiden fusiones automáticas",()=>{
 const x=proposeEvidenceLaboratoryMerges(providers,aliases,new Set(["2"]));
 assert.equal(x.operations.length,0);
 assert.ok(x.review.some(x=>x.reason==="manual"));
 const y=proposeEvidenceLaboratoryMerges(providers,aliases,new Set(),new Set(["1"]));
 assert.equal(y.operations.length,0);
 assert.ok(y.review.some(x=>x.reason==="configuracion_o_historial"));
});
test("no se unifica por nombre sin prueba cruzada, ni por código local aislado",()=>{
 const x=proposeEvidenceLaboratoryMerges([
  {id:"10",name:"FARMACIA ABC",class:"DIRECTO",active:true},
  {id:"11",name:"Farmacia ABC",class:"DIRECTO",active:true}
 ],[{supplier:"10",pharmacyCode:"ABA",sourceCode:"10"},
   {supplier:"11",pharmacyCode:"EUR",sourceCode:"10"}]);
 assert.equal(x.operations.length,0);
});
