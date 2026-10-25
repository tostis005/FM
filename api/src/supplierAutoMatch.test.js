import test from "node:test";
import assert from "node:assert/strict";
import {buildAutomaticSupplierMatches} from "./supplierAutoMatch.js";

test("vinculación automática segura: reconoce Cinfa, excluye códigos y conserva las manuales",()=>{
 const labs=["Laboratorios Cinfa S.A.","Zimfa","0001","A0062"];
 const suppliers=[
  {sourceCode:"0005",name:"CINFA"},
  {sourceCode:"4065",name:"Laboratorios Cinfa, S.A."},
  {sourceCode:"0001",name:"0001"},
  {sourceCode:"B003",name:"PROVEEDOR 3"},
  {sourceCode:"1004",name:"ZIMFA",cooperative:true},
  {sourceCode:"1005",name:"Zimfa",laboratoryKey:"N:OTRO"},
  {sourceCode:"1006",name:"Zimfa"}
 ];
 const found=buildAutomaticSupplierMatches(suppliers,labs);
 assert.deepEqual(found.map(x=>[x.sourceCode,x.laboratoryKey]).sort(),[
  ["0005","N:CINFA"],["1006","N:ZIMFA"],["4065","N:CINFA"]]);
});
test("un mismo código con dos nombres/laboratorios diferentes nunca se asigna automáticamente",()=>{
 assert.deepEqual(buildAutomaticSupplierMatches([
  {sourceCode:"A1",name:"Zimfa"},{sourceCode:"A1",name:"Cinfa"}
 ],["Zimfa","Cinfa"]),[]);
});
