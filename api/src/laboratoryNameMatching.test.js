import test from "node:test";
import assert from "node:assert/strict";
import {nameAffinity,advancedLaboratoryCandidates,nameRoot} from "./laboratoryNameMatching.js";
test("variaciones ortográficas reconocidas y grupos comerciales separados",()=>{
 assert.equal(nameRoot("LABORATORIOS ARKOPHARMA S.A."),nameRoot("Arkofarma SA"));
 assert.equal(nameAffinity("Laboratorios ARKOPHARMA SA","Arkofarma")?.reason,"mismo_nombre_normalizado");
 assert.equal(nameAffinity("CINFA SA","Laboratorios Cinfa")?.reason,"mismo_nombre_normalizado");
 assert.equal(nameAffinity("L OREAL","L OREAL VICHY"),null);
 assert.equal(nameAffinity("Distribuidora Roche","Roche SA"),null);
});
test("los grupos no cruzan clasificaciones ni inactivos",()=>{
 const rows=[
  {id:"1",name:"Laboratorios ARKOPHARMA",class:"DIRECTO",active:true},
  {id:"2",name:"ARKOFARMA SA",class:"DIRECTO",active:true},
  {id:"3",name:"ARKOPHARMA",class:"MAYORISTA",active:true},
  {id:"4",name:"Arkofarma",class:"DIRECTO",active:false}
 ];
 const {candidates}=advancedLaboratoryCandidates(rows,[]);
 assert.deepEqual(candidates.map(x=>[x.a,x.b]),[["1","2"]]);
});
test("los identificadores manuales e historiales se presentan protegidos",()=>{
 const rows=[{id:"1",name:"BAYER LABORATORIOS",class:"DIRECTO",active:true},
 {id:"2",name:"BAYER",class:"DIRECTO",active:true}];
 const out=advancedLaboratoryCandidates(rows,[],new Set(["2"]),new Set(["1"]));
 assert.equal(out.candidates.length,1);
 assert.equal(out.candidates[0].eligible,false);
 assert.equal(out.candidates[0].manual,true);
 assert.equal(out.candidates[0].history,true);
});
