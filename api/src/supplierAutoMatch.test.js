import test from "node:test";
import assert from "node:assert/strict";
import {buildAutomaticSupplierMatches,buildLocalSupplierGroupSuggestions} from "./supplierAutoMatch.js";

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

test("dos proveedores ERP sin AEMPS, con y sin SA, se proponen bajo una identidad propia",()=>{
 const suppliers=[
  {pharmacyId:"1",sourceCode:"0001",name:"LABORATORIOS EJEMPLO S.A."},
  {pharmacyId:"2",sourceCode:"0001",name:"Ejemplo"},
  {pharmacyId:"3",sourceCode:"0021",name:"Farmacia independiente"},
  {pharmacyId:"4",sourceCode:"0005",name:"LABORATORIOS EJEMPLO SA",cooperative:true}
 ];
 const rows=buildLocalSupplierGroupSuggestions(suppliers);
 assert.equal(rows.length,2);
 assert.deepEqual(rows.map(r=>r.pharmacyId),["1","2"]);
 assert.ok(rows.every(r=>r.laboratoryKey==="N:EJEMPLO"));
 assert.ok(rows.every(r=>r.source==="farmatic"));
});
test("no deducir identidad propia por código ni sobrescribir asignaciones explícitas",()=>{
 const suppliers=[
  {pharmacyId:"1",sourceCode:"0001",name:"Proveedor 10"},
  {pharmacyId:"2",sourceCode:"0001",name:"Otro fabricante"},
  {pharmacyId:"3",sourceCode:"0002",name:"Otro fabricante",laboratoryKey:"N:DECISION_MANUAL"},
  {pharmacyId:"4",sourceCode:"0003",name:"LABORATORIOS OTRO FABRICANTE SA"}
 ];
 assert.deepEqual(buildLocalSupplierGroupSuggestions(suppliers),[]);
});
