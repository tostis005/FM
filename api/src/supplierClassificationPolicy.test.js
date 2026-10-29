import test from "node:test";
import assert from "node:assert/strict";
import {normalizedSupplierName,proposeSupplierClassifications} from "./supplierClassificationPolicy.js";
const rows=(names,clase="SIN_CLASIFICAR")=>names.map(([id,name])=>({id:String(id),name,class:clase,active:true}));
const rules=names=>proposeSupplierClassifications(rows(names),[]);

test("Alliance Healthcare es mayorista, no Allianz Care ni laboratorio",()=>{
 const source=rules([
  [1,"01 ALLIANCE HEALTHCARE"],[2,"01-ALLIANCE HEALTCARE"],
  [3,"1-Alliance Healthcare"],[4,"Allianz Care"]
 ]);
 assert.deepEqual(source.operations.map(o=>o.to),
  ["MAYORISTA","MAYORISTA","MAYORISTA","OTROS"]);
});
test("no confunde servicios, correcciones e internos con laboratorios",()=>{
 const plan=rules([
  [1,"CADUCADOS PARAFARMACIA LABORATORIO"],[2,"CORRECCIÓN DE STOCKS"],
  [3,"0 AMPEDIA MERCANTIL SL"],[4,"FARMACIA ROMA"],
  [5,"CONSOFT S.A.U."],[6,"ALCAMPO"],[7,"LEROY MERLIN"],
  [8,"ALLIANCE HEALTHCARE"],[9,"COFARES ESPEC"],
  [10,"ADAMED LABORATORIOS S.L."],[11,"ABBVIE SPAIN S.L.U."]
 ]);
 assert.deepEqual(plan.operations.map(x=>x.to),
  ["INTERNO","INTERNO","INTERNO","OTROS","OTROS","OTROS",
   "OTROS","MAYORISTA","MAYORISTA","DIRECTO","DIRECTO"]);
});
test("maestro ambiguo o empresas desconocidas quedan separadas",()=>{
 const master=[
  ...rows([[10,"AAA S.L."],[11,"Sin datos identificables"]]),
  ...rows([[1123,"AAA S.L."]],"DIRECTO"),
  ...rows([[2222,"AAA S.L."]],"MAYORISTA")
 ];
 const result=proposeSupplierClassifications(master,[]);
 assert.equal(result.operations.length,0);
 assert.equal(result.uncertain.length,2);
 assert.ok(normalizedSupplierName("01-Alliance Healthcare")===normalizedSupplierName("Alliance Healthcare"));
});
test("coincidencia exacta de un fabricante existente, sin inferir por código ERP",()=>{
 const master=[...rows([[19,"LABORATORIOS MEDICALS.A."]]),
  ...rows([[1276,"LABORATORIOS MEDICAL S.A."]],"DIRECTO")];
 const aliases=[{supplier:"19",pharmacyCode:"A",sourceCode:"10",sourceName:"LABORATORIOS MEDICAL S.A.",
  provenance:"farmatic"},{supplier:"1276",pharmacyCode:"B",sourceCode:"999",
   sourceName:"LABORATORIOS MEDICAL S.A.",provenance:"excel"}];
 const plan=proposeSupplierClassifications(master,aliases);
 assert.equal(plan.operations.length,1);
 assert.equal(plan.operations[0].to,"DIRECTO");
 const protectedAlias=proposeSupplierClassifications(master,[{...aliases[0],provenance:"manual"},aliases[1]]);
 assert.equal(protectedAlias.operations.length,0);
 assert.equal(protectedAlias.skipped.length,1);
});
