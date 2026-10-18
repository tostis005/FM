import test from "node:test";
import assert from "node:assert/strict";
import {reconcilePharmacyIds} from "./reportFilterScopes.js";

const pharmacies=[
 {id:"1",name:"Abadía",sourceCode:"ABA",databaseCode:"ABA"},
 {id:"5",name:"Valdemarías",sourceCode:"POL",databaseCode:"VAL",displayCode:"POL"}
];
test("Valdemarías recupera filtros antiguos POL/VAL y envía id 5",()=>{
 assert.deepEqual(reconcilePharmacyIds(["POL"],pharmacies),["5"]);
 assert.deepEqual(reconcilePharmacyIds(["VAL"],pharmacies),["5"]);
 assert.deepEqual(reconcilePharmacyIds(["5"],pharmacies),["5"]);
 assert.deepEqual(reconcilePharmacyIds(["POL","VAL","5"],pharmacies),["5"]);
});
test("no mezcla códigos antiguos ni farmacias fuera del contexto permitido",()=>{
 assert.deepEqual(reconcilePharmacyIds(["ABA","POL","99","XYZ"],pharmacies),["1","5"]);
 assert.deepEqual(reconcilePharmacyIds(["POL"],[pharmacies[0]]),[]);
 assert.deepEqual(reconcilePharmacyIds([],pharmacies),[]);
});
test("no resuelve códigos ERP ambiguos entre farmacias distintas",()=>{
 const list=[{id:"10",sourceCode:"SAME"},{id:"11",sourceCode:"SAME"}];
 assert.deepEqual(reconcilePharmacyIds(["SAME"],list),[]);
 assert.deepEqual(reconcilePharmacyIds(["10","11"],list),["10","11"]);
});
