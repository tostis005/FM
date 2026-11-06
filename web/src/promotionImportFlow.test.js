import test from "node:test";
import assert from "node:assert/strict";
import {promotionExcelBatchId,importResultSummary,promotionVisibleInPharmacyScope} from "./promotionImportFlow.js";

const sample=bytes=>({arrayBuffer:async()=>Uint8Array.from(bytes).buffer});
test("el mismo Excel conserva ID de lote incluso tras recargar la página en un móvil",async()=>{
 const first=await promotionExcelBatchId(sample([80,75,3,4,10,255]));
 const again=await promotionExcelBatchId(sample([80,75,3,4,10,255]));
 const changed=await promotionExcelBatchId(sample([80,75,3,4,10,254]));
 assert.equal(first,again);
 assert.notEqual(first,changed);
 assert.match(first,/^XLSX-[0-9A-F]+-[0-9A-F]{16}$/);
});
test("la confirmación distingue promos nuevas, repetidas y borradores sin farmacia",()=>{
 const source="Excel: NOVIEMBRE 2026 PROMOCIONES.xlsx";
 const campaigns=[{id:"1"},{id:"2"},{id:"3"}];
 const server={imported:2,skipped:1,promotions:[
  {id:"1",source,targets:{}},{id:"2",source,targets:{"1":12}},
  {id:"3",source,targets:{}},{id:"old",source:"Excel: Octubre.xlsx",targets:{}}
 ]};
 assert.deepEqual(importResultSummary(server,campaigns,source),{
  imported:2,skipped:1,visible:3,drafts:2,source
 });
});
test("un resultado incompleto de red nunca se presenta como importación correcta",()=>{
 assert.throws(()=>importResultSummary({imported:2,skipped:0,promotions:[]},
  [{},{},{}],"Excel: noviembre.xlsx"),/no confirmó/);
});

test("un borrador sin farmacia se ve aunque exista filtro global; las campañas asignadas respetan el ámbito",()=>{
 assert.equal(promotionVisibleInPharmacyScope({status:"Borrador",targets:{}},["1"]),true);
 assert.equal(promotionVisibleInPharmacyScope({targets:{"2":10}},["1"]),false);
 assert.equal(promotionVisibleInPharmacyScope({targets:{"1":10}},["1"]),true);
 assert.equal(promotionVisibleInPharmacyScope({targets:{"2":10}},[]),true);
});
