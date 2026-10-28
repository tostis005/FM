import test from "node:test";
import assert from "node:assert/strict";
import {canonicalLabName,proposeLaboratoryMerges} from "./laboratoryMergeCandidates.js";
test("normaliza diferencias claras de razón social sin borrar identidad",()=>{
 assert.equal(canonicalLabName("LABORATORIOS CINFA, S.A."),"CINFA");
 assert.equal(canonicalLabName("Cinfa SLU"),"CINFA");
 assert.equal(canonicalLabName("002- LABORATORIO CINFA S. A. U."),"CINFA");
 assert.equal(canonicalLabName("BAYER HISPANIA SA"),"BAYER HISPANIA");
 assert.notEqual(canonicalLabName("BAYER"),canonicalLabName("BAYER HISPANIA"));
});
test("unifica solo nombre estructuralmente idéntico, clase igual y sin vínculo manual",()=>{
 const rows=[{id:"11",name:"Laboratorios Cinfa, S.A.",class:"DIRECTO",active:true},
  {id:"12",name:"CINFA",class:"DIRECTO",active:true},
  {id:"13",name:"CINFA HISPANIA",class:"DIRECTO",active:true},
  {id:"14",name:"CINFA",class:"MAYORISTA",active:true},
  {id:"15",name:"CINFA",class:"DIRECTO",active:false},
  {id:"16",name:"Laboratorios Cinfa, S.A.",class:"VACUNAS",active:true}];
 const v=proposeLaboratoryMerges(rows,new Map([["11",5],["12",12]]));
 assert.deepEqual(v.operations.map(x=>({from:x.from,to:x.to})),[{from:"11",to:"12"}]);
 assert.equal(v.review.length,0);
 const protectedResult=proposeLaboratoryMerges(rows,new Map(),new Set(["11"]));
 assert.equal(protectedResult.operations.length,0);
 assert.equal(protectedResult.review.length,1);
});
test("descarta nombres vagos y empresas de distribución",()=>{
 const rows=[{id:"2",name:"Cooperativa Farma SA",class:"DIRECTO"},
  {id:"3",name:"Cooperativa Farma SL",class:"DIRECTO"},
  {id:"4",name:"Proveedor 0007",class:"DIRECTO"},
  {id:"5",name:"Proveedor 0007 S.L.",class:"DIRECTO"},
  {id:"6",name:"BAYER",class:"DIRECTO"},
  {id:"7",name:"BAYER HISPANIA",class:"DIRECTO"}];
 assert.equal(proposeLaboratoryMerges(rows).operations.length,0);
});
