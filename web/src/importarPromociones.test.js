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
  const first=importCampaignRows([["LAB","MARCA","OFERTA","INICIO","FIN"],["TEST","GAMA","20% DTO","1 OCTUBRE","31 OCTUBRE"]],[
    ["LAB","GAMA","CN","DESCRIPCION","PROMOCION","DESDE","HASTA"],
    ["TEST","GAMA","012345","","20% DTO","1 OCTUBRE","31 OCTUBRE"]
  ]);
  const existing=[{...first[0],targets:{"1":11}}];
  const second=importCampaignRows([["LAB","MARCA","OFERTA","INICIO","FIN"],["TEST","GAMA","20% DTO","1 OCTUBRE","31 OCTUBRE"]],[
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
 assert.equal(importedPromotionStatus({...promo,targets:{"1":12,"2":""}},now),"Activa");
 assert.equal(importedPromotionStatus({...promo,targets:{"1":0}},now),"Borrador");
 assert.equal(importedPromotionStatus({...promo,cns:[]},now),"Activa");
 assert.equal(importedPromotionStatus({...promo,end:""},now),"Activa");
 assert.equal(importedPromotionStatus({...promo,start:"",end:""},now),"Borrador");
});
test("el estado de importación usa la fecha civil de la farmacia, no el UTC",()=>{
 const promo={cns:["123456"],targets:{"1":25},start:"2026-10-19",end:"2026-10-19"};
 const midnight=new Date("2026-10-19T22:30:00Z");
 assert.equal(importedPromotionStatus(promo,midnight,"Europe/Madrid"),"Finalizada");
 assert.equal(importedPromotionStatus(promo,midnight,"America/Bogota"),"Activa");
});

test("primera fila vacía detiene la importación: ni texto posterior ni CN huérfanos crean promociones",()=>{
 const a=[
  ["LABORATORIO","MARCA","NOMBRE PROMOCIÓN","FECHA DE INICIO","FECHA DE FIN"],
  ["BEIERSDORF","EUCERIN","20% DTO","1 OCTUBRE","31 OCTUBRE"],
  [null,null,null,null,null],
  ["NO HACER ESTAS PROMOCIONES",null,null,null,null],
  ["HARTMANN","KNEIPP GUMMIES","4€ DTO","1 OCTUBRE","31 DICIEMBRE"]
 ];
 const b=[
  ["LAB","GAMA","CN","DESCRIPCION","PROMOCION"],
  ["BEIERSDORF","EUCERIN CORPORAL","001474","Eucerin","20% DTO"],
  ["HARTMANN","KNEIPP GUMMIES","123456","No importar","4€ DTO"]
 ];
 const found=importCampaignRows(a,b);
 assert.equal(found.length,1);
 assert.equal(found[0].sourceRow,2);
 assert.deepEqual(found[0].cns,["001474"]);
 assert.equal(importCampaignRows([],b).length,0);
});
test("laboratorio/marca es el vínculo y la oferta separa gamas duplicadas",()=>{
 const a=[
  ["LAB","MARCA","OFERTA","INICIO","FIN"],
  ["CANTABRIA LABS","IRALTONE","3x2","1 OCTUBRE","31 OCTUBRE"],
  ["NATIVE","PHYTO","50% DTO 2ª UD","1 OCTUBRE","31 OCTUBRE"],
  ["NATIVE","PHYTO","20% DTO","1 OCTUBRE","31 OCTUBRE"],
  ["LOREAL","LA ROCHE POSAY EFFACLAR","20% DTO","1 OCTUBRE","31 OCTUBRE"]
 ];
 const b=[
  ["LAB","GAMA","CN","DESC","OFERTA"],
  ["CANTABRIA","IRALTONE","123456","Iraltone","3X2"],
  ["NATIVE","PHYTO TTO","123457","Phyto tratamientos","50% 2ª UD"],
  ["NATIVE","PHYTO AMPOLLAS","123458","Phyto ampollas",0.2],
  ["LA ROCHE POSAY","EFFACLAR","123459","Effaclar",0.2],
  ["CANTABRIA","NEORETIN","123460","No corresponde","40% 2ª UD"]
 ];
 const x=importCampaignRows(a,b);
 assert.deepEqual(x.map(p=>p.cns),[["123456"],["123457"],["123458"],["123459"]]);
});
test("dos promociones URIAGE separadas por su descripción mantienen ambos CN y IDs únicos",()=>{
 const a=[
  ["LAB","MARCA","OFERTA","INICIO","FIN","DESCRIPCIÓN"],
  ["PUIG DERMA","URIAGE","5€ DTO","1 OCTUBRE","31 OCTUBRE","Crema y Bálsamo Xemose"],
  ["PUIG DERMA","URIAGE","5€ DTO","1 OCTUBRE","31 OCTUBRE","Los sérums de la gama"],
 ];
 const b=[
  ["LAB","GAMA","CN","DESC","OFERTA"],
  ["URIAGE","URIAGE","189666","URIAGE XEMOSE BALSAMO",5],
  ["URIAGE","URIAGE","152281","URIAGE XEMOSE CREMA",5],
  ["URIAGE","URIAGE","199837","URIAGE BARIEDERM CICA DAILY SERUM",5],
  ["URIAGE","URIAGE","217776","URIAGE ROSELIANE SERUM",5]
 ];
 const x=importCampaignRows(a,b);
 assert.equal(x.length,2);
 assert.notEqual(x[0].id,x[1].id);
 assert.deepEqual(x[0].cns,["189666","152281"]);
 assert.deepEqual(x[1].cns,["199837","217776"]);
});

test("si el cruce principal no aporta CN, comparar solo Marca y Gama, ignorando laboratorio y oferta",()=>{
 const resumen=[
  ["LABORATORIO","MARCA","NOMBRE PROMOCIÓN","INICIO","FIN"],
  ["MARCA DISTRIBUIDORA","CAPILAR","3€ DTO 1 UD","1 OCTUBRE","31 OCTUBRE"],
  ["OTRA MARCA","GAMA COSMETICA PEDIATRICA","20% DTO","1 OCTUBRE","31 OCTUBRE"],
  [],
  ["NO HACER ESTAS PROMOCIONES", "NUXE HAIR", "20% DTO", "1 OCTUBRE", "31 OCTUBRE"]
 ];
 const cns=[
  ["LABORATORIO","GAMA","CN","DESCRIPCIÓN","OFERTA"],
  ["NUXE","NUXE HAIR","112233","Champú Nuxe","OFERTA DIFERENTE"],
  ["SUAVINEX","SUAVINEX COSMETICA","112234","Suavinex gel",0.2],
  ["SIN PROMOCIÓN","NUXE HAIR","998877","Otra gama igual pero oferta distinta","3X2"]
 ];
 const campaigns=importCampaignRows(resumen,cns);
 assert.equal(campaigns.length,2,"solo filas anteriores a la primera fila en blanco");
 assert.deepEqual(campaigns[0].cns,["112233","998877"],"al usar solo gama se incluyen las coincidencias de gama");
 assert.deepEqual(campaigns[1].cns,["112234"]);
 assert.ok(campaigns.every(p=>p.importWarnings.some(w=>w.includes("MARCA y GAMA"))));
});
test("el segundo intento nunca se ejecuta si ya hay CN por laboratorio y marca",()=>{
 const resumen=[["LAB","MARCA","OFERTA","INICIO","FIN"],["SUNSTAR","GUM","3X2","1 OCTUBRE","31 OCTUBRE"]];
 const listado=[["LAB","GAMA","CN","DESC","OFERTA"],
   ["SUNSTAR","GUM","123456","GUM","3X2"],
   ["OTRA","GUM","456789","Una gama igual de otro laboratorio","50% DTO"]];
 const out=importCampaignRows(resumen,listado);
 assert.deepEqual(out[0].cns,["123456"]);
 assert.ok(!out[0].importWarnings.some(w=>w.includes("MARCA y GAMA")));
});


test("fecha española con de y fin no interpretable preservan el texto original",()=>{
 assert.equal(excelDate("1 de octubre"),"2026-10-01");
 assert.equal(excelDate("31 de diciembre"),"2026-12-31");
 assert.equal(excelDate("31/12"),"2026-12-31");
 for(const raw of ["Hasta agotar existencias","Hasta fin de existencias","Hasta nuevo aviso",""]){
  const promos=importCampaignRows(
   [["LAB","MARCA","OFERTA","INICIO","FIN"],["LAB","GAMA","20% DTO","1 de octubre",raw]],
   [["LAB","GAMA","CN","DESC","OFERTA"],["LAB","GAMA","123456","Crema","20% DTO"]]);
  assert.equal(promos[0].end,"");
  assert.equal(promos[0].endRaw,raw);
  assert.ok(promos[0].importWarnings.some(w=>w.includes("30 días")));
 }
});
test("cambio de año sin año explícito: diciembre a enero",()=>{
 const promos=importCampaignRows(
  [["LAB","MARCA","OFERTA","INICIO","FIN"],["LAB","GAMA","20% DTO","1 enero","31 enero"]],
  [["LAB","GAMA","CN","DESC","OFERTA"],["LAB","GAMA","123456","Crema","20% DTO"]],
  2026,new Date("2026-12-15T12:00:00Z"));
 assert.equal(promos[0].start,"2027-01-01");
 assert.equal(promos[0].end,"2027-01-31");
 const across=importCampaignRows(
  [["LAB","MARCA","OFERTA","INICIO","FIN"],["LAB","GAMA","20% DTO","15 diciembre","15 enero"]],
  [["LAB","GAMA","CN","DESC","OFERTA"],["LAB","GAMA","123456","Crema","20% DTO"]],
  2026,new Date("2026-12-15T12:00:00Z"));
 assert.equal(across[0].start,"2026-12-15");
 assert.equal(across[0].end,"2027-01-15");
});
