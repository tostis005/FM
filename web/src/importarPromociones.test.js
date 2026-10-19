import test from "node:test";
import assert from "node:assert/strict";
import {excelDate,importCampaignRows,mergeImportedPromos,importedPromotionStatus} from "./importarPromociones.js";

test("fechas españolas y serial Excel",()=>{
  assert.equal(excelDate("1 OCTUBRE"),"2026-10-01");
  assert.equal(excelDate("1 OOCTUBRE"),"2026-10-01");
  assert.equal(excelDate("31-dic"),"2026-12-31");
  assert.equal(excelDate("FIN EXISTENCIAS"),"");
  assert.equal(excelDate(46296),"2026-10-01");
});
test("3x2, segunda unidad y CN con cero inicial quedan en borrador",()=>{
  const promos=importCampaignRows(
    [["LABORATORIO","MARCA","NOMBRE PROMOCIÓN","DESDE","HASTA"],["TEST","GUM","3x2","1 OCTUBRE","31 OCTUBRE"]],
    [["LAB","GAMA","CN","DESCRIPCION","PROMOCION","DESDE","HASTA"],
      ["TEST","GUM","001474","Prueba","3X2","1 OCTUBRE","31 OCTUBRE"],
      ["TEST","GUM","164432","Prueba","3X2","1 OCTUBRE","31 OCTUBRE"]]
  );
  assert.equal(promos.length,1);
  assert.equal(promos[0].type,"tres_por_dos");
  assert.deepEqual(promos[0].cns,["001474","164432"]);
  assert.equal(promos[0].status,"Borrador");
});
test("reimportar no duplica; nuevo CN completa campaña y respeta objetivos",()=>{
  const first=importCampaignRows([],[
    ["LAB","GAMA","CN","DESCRIPCION","PROMOCION","DESDE","HASTA"],
    ["TEST","GAMA","012345","","20% DTO","1 OCTUBRE","31 OCTUBRE"]
  ]);
  const existing=[{...first[0],targets:{"1":11}}];
  const second=importCampaignRows([],[
    ["LAB","GAMA","CN","DESCRIPCION","PROMOCION","DESDE","HASTA"],
    ["TEST","GAMA","012345","","20% DTO","1 OCTUBRE","31 OCTUBRE"],
    ["TEST","GAMA","222333","","20% DTO","1 OCTUBRE","31 OCTUBRE"]
  ]);
  const merged=mergeImportedPromos(existing,second);
  assert.equal(merged.additions.length,0);
  assert.equal(merged.updates.length,1);
  assert.deepEqual(merged.updates[0].cns,["012345","222333"]);
  assert.equal(merged.updates[0].targets["1"],11);
  assert.equal(mergeImportedPromos(merged.updates,second).duplicates,1);
});

test("importar objetivos asignados activa promociones vigentes, archiva vencidas",()=>{
 const now=new Date("2026-10-19T22:30:00Z");
 const promo={cns:["001474"],targets:{"1":12,"2":5},start:"2026-10-01",end:"2026-10-31"};
 assert.equal(importedPromotionStatus(promo,now),"Activa");
 assert.equal(importedPromotionStatus({...promo,end:"2026-10-18"},now),"Finalizada");
 assert.equal(importedPromotionStatus({...promo,start:"2026-11-01",end:"2026-11-30"},now),"Borrador");
 assert.equal(importedPromotionStatus({...promo,targets:{}},now),"Borrador");
 assert.equal(importedPromotionStatus({...promo,targets:{"1":12,"2":""}},now),"Borrador");
 assert.equal(importedPromotionStatus({...promo,targets:{"1":0}},now),"Borrador");
 assert.equal(importedPromotionStatus({...promo,cns:[]},now),"Borrador");
 assert.equal(importedPromotionStatus({...promo,start:"",end:""},now),"Borrador");
});
test("el estado de importación usa la fecha civil de la farmacia, no el UTC",()=>{
 const promo={cns:["123456"],targets:{"1":25},start:"2026-10-19",end:"2026-10-19"};
 const midnight=new Date("2026-10-19T22:30:00Z");
 assert.equal(importedPromotionStatus(promo,midnight,"Europe/Madrid"),"Finalizada");
 assert.equal(importedPromotionStatus(promo,midnight,"America/Bogota"),"Activa");
});
