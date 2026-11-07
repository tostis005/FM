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
const source="Excel: NOVIEMBRE 2026 PROMOCIONES.xlsx";
const makeRow=n=>({id:"P"+n,source,sourceRow:n+1,sourceSheet:"RESUMEN PROMOS",
 start:"2026-11-01",end:"2026-11-30",laboratory:"LAB",range:"GAMA "+n,
 originalOffer:"20% DTO",description:"Campaña "+n,targets:{}});
test("confirmación comprueba las filas realmente recuperables, no los contadores",()=>{
 const campaigns=[makeRow(1),makeRow(2),makeRow(3)];
 const server={imported:2,skipped:1,promotions:[
  {...campaigns[0]}, {...campaigns[1],targets:{"1":12}},
  {...campaigns[2]}, {...makeRow(4),source:"Excel: Octubre.xlsx"}
 ]};
 assert.deepEqual(importResultSummary(server,campaigns,source),{
  imported:2,skipped:1,visible:3,drafts:2,source,visibleIds:["P1","P2","P3"]
 });
});
test("51 supuestas duplicadas pero invisibles no deben considerarse importadas con éxito",()=>{
 const campaigns=Array.from({length:51},(_,i)=>makeRow(i+1));
 assert.throws(()=>importResultSummary({imported:0,skipped:51,promotions:[]},campaigns,source),
  /no devuelve todas las filas/);
});
test("reimportar después del borrado puede crear 51 campañas y mostrarlas",()=>{
 const campaigns=Array.from({length:51},(_,i)=>makeRow(i+1));
 const first=importResultSummary({imported:51,skipped:0,promotions:campaigns},campaigns,source);
 const repeated=importResultSummary({imported:0,skipped:51,promotions:campaigns},campaigns,source);
 const afterDelete=importResultSummary({imported:51,skipped:0,promotions:campaigns},campaigns,source);
 assert.equal(first.visible,51);assert.equal(repeated.visible,51);
 assert.equal(afterDelete.imported,51);assert.equal(afterDelete.visibleIds.length,51);
});
test("múltiples subidas antiguas del mismo Excel se muestran una vez por fila",()=>{
 const campaigns=[makeRow(1),makeRow(2)];
 const server={imported:0,skipped:2,promotions:[
  {...campaigns[0],id:"older"}, {...campaigns[0],id:"newer"},
  {...campaigns[1],id:"second"}
 ]};
 assert.equal(importResultSummary(server,campaigns,source).visible,2);
});
test("reconoce el mismo Excel por contenido aunque el teléfono lo renombre",()=>{
 const fileName="Excel: NOVIEMBRE (4).xlsx";
 const oldSource="Excel: NOVIEMBRE (3).xlsx";
 const campaigns=[{...makeRow(1),source:fileName,importBatchId:"XLSX-123-ABCD"}];
 const alreadyStored=[{...campaigns[0],id:"EXISTING",source:oldSource}];
 assert.deepEqual(importResultSummary({imported:0,skipped:1,promotions:alreadyStored},
   campaigns,fileName).visibleIds,["EXISTING"]);
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
