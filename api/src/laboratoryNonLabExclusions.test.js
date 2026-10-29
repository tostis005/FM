import test from "node:test";
import assert from "node:assert/strict";
import {NON_LAB_SOURCES,verifiedNonLabExclusions} from "./laboratoryNonLabExclusions.js";
import {planUnclassifiedLaboratoryAliases} from "./laboratoryUnclassifiedReconcile.js";
test("los proveedores ajenos a laboratorios quedan identificados por ID y nombre",()=>{
 const master=[...NON_LAB_SOURCES].map(([id,name])=>({id,name}));
 const ids=verifiedNonLabExclusions(master);
 assert.equal(ids.size,NON_LAB_SOURCES.size);
 assert.ok(ids.has("1386")); // comercio
 assert.ok(ids.has("1949")); // cooperativa / mayorista
 assert.ok(ids.has("1632")); // Internet
 master[0].name="DATO MODIFICADO";
 assert.throws(()=>verifiedNonLabExclusions(master),/Cambiaron los datos/);
});
test("los no laboratorios permanecen separados aunque el nombre y el CN coincidan",()=>{
 const rows=[
  {id:"1386",name:"ALCAMPO",class:"SIN_CLASIFICAR",active:true},
  {id:"763",name:"ALCAMPO S.A.U",class:"DIRECTO",active:true},
  {id:"1355",name:"ALLERGAN",class:"SIN_CLASIFICAR",active:true},
  {id:"1090",name:"ALLERGAN",class:"DIRECTO",active:true}
 ];
 const aliases=[
  {supplier:"1386",pharmacyCode:"VAL",sourceCode:"1"},
  {supplier:"763",pharmacyCode:"ABA",sourceCode:"1"},
  {supplier:"1355",pharmacyCode:"VAL",sourceCode:"2"},
  {supplier:"1090",pharmacyCode:"ABA",sourceCode:"2"}
 ];
 const result=planUnclassifiedLaboratoryAliases(rows,aliases,new Set(["763","1090"]),
  new Set(),new Set(),new Set(["1386"]));
 assert.deepEqual(result.operations.map(x=>[x.from,x.to]),[["1355","1090"]]);
 assert.equal(result.status.excluded,1);
});
