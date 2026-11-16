import test from "node:test";
import assert from "node:assert/strict";
import {normalizeGenericOffers,calculateGenericAllocation} from "./genericosOfertas.js";

const row=(overrides={})=>({
 laboratory:"CINFA",cn:"659407",name:"Medicamento EFG",pvl:6.4,
 discount:0.65,net:2.24,iva:0.04,puc:2.3296,
 minimum:null,pack:null,box:null,...overrides
});
test("importación de tarifas por pestaña y CN sin inventar equivalencias",()=>{
 const data=normalizeGenericOffers([
  row(),row({laboratory:"ALMUS",cn:"721824",puc:0.93184}),
  row()
 ]);
 assert.equal(data.rows.length,2);
 assert.equal(data.duplicates.length,1);
 assert.deepEqual(data.rows.map(r=>r.laboratory),["CINFA","ALMUS"]);
});
test("rechaza tarifas distintas para el mismo CN y laboratorio",()=>{
 assert.throws(()=>normalizeGenericOffers([row(),row({puc:2.1})]),/tarifas distintas/);
});
test("no acepta CN, porcentaje ni PUC no válidos",()=>{
 for(const invalid of [row({cn:"abc"}),row({puc:-1}),row({discount:65}),
  row({minimum:-10}),row({iva:1.2})])
  assert.throws(()=>normalizeGenericOffers([invalid]),/inválidos/);
});
test("reparto objetivo conserva porcentaje restante y unidades",()=>{
 assert.deepEqual(calculateGenericAllocation(101,[{percent:20},{percent:30}]),[20,31]);
 assert.deepEqual(calculateGenericAllocation(3,[{percent:50},{percent:50}]),[2,1]);
 assert.throws(()=>calculateGenericAllocation(100,[{percent:60},{percent:60}]),/superar/);
});
