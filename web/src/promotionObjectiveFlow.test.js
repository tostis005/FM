import test from "node:test";
import assert from "node:assert/strict";
import {objectiveDraftSelection,mergeObjectivesIntoPromotion,objectivePromotionIsEditable} from "./promotionObjectiveFlow.js";
const raw={id:"X12",name:"La campaña",laboratory:"Lab",range:"Gama",originalOffer:"3x2",
 source:"Excel: NOVIEMBRE 2026.xlsx",sourceRow:2,status:"Borrador",
 cns:["001234","456789"],cnDescriptions:{"001234":"Leche","456789":"Champú"},
 targets:{},sales:{},start:"2026-11-01",end:"2026-11-30"};
test("precarga CN y nombres del Excel y farmacias disponibles en el planificador",()=>{
 const data=objectiveDraftSelection(raw,[{id:1},{id:2}]);
 assert.deepEqual(data.products.map(p=>p.cn),["001234","456789"]);
 assert.deepEqual(data.products.map(p=>p.description),["Leche","Champú"]);
 assert.deepEqual(data.pharmacyIds,["1","2"]);
});
test("el objetivo sobre un borrador conserva ID, oferta y descripción, activando noviembre con metas",()=>{
 const draft=mergeObjectivesIntoPromotion(raw,{cns:raw.cns,
  targets:{"1":12,"2":20},cnDescriptions:{"001234":"Leche"},
  objectiveBaseline:"previous",objectiveBaselineRange:{from:"2026-10-01",to:"2026-10-31"},
  objectiveRates:{"1":8}},new Date("2026-11-06T12:00:00Z"));
 assert.equal(draft.id,raw.id);assert.equal(draft.sourceRow,2);assert.equal(draft.name,raw.name);
 assert.deepEqual(draft.targets,{"1":12,"2":20});
 assert.deepEqual(draft.cns,raw.cns);assert.equal(draft.status,"Activa");
 assert.equal(draft.statusSource,"automatic");
 assert.deepEqual(raw.targets,{});
});
test("no activa campaña futura; respeta las campañas manuales y cerradas",()=>{
 const plan={cns:raw.cns,targets:{"1":4}};
 assert.equal(mergeObjectivesIntoPromotion({...raw,start:"2026-12-01",end:"2026-12-31"},plan,new Date("2026-11-06")).status,"Borrador");
 assert.equal(mergeObjectivesIntoPromotion({...raw,source:"Manual"},plan,new Date("2026-11-06")).status,"Borrador");
 assert.equal(mergeObjectivesIntoPromotion({...raw,status:"Finalizada",closedOn:"2026-10-31"},plan,new Date("2026-11-06")).status,"Finalizada");
});
test("rechaza objetivos no válidos y no reemplaza campañas fuera de ámbito",()=>{
 assert.throws(()=>mergeObjectivesIntoPromotion(raw,{cns:[],targets:{"1":2}}),/CN/);
 assert.throws(()=>mergeObjectivesIntoPromotion(raw,{cns:raw.cns,targets:{"1":""}}),/unidades enteras/);
 assert.throws(()=>mergeObjectivesIntoPromotion(raw,{cns:raw.cns,targets:{"1":2.5}}),/enteras/);
 assert.equal(objectivePromotionIsEditable(raw),true);
 assert.equal(objectivePromotionIsEditable({...raw,managerCanEdit:false}),false);
});

test("una promoción sin clasificación sigue en borrador aunque ya tenga metas",()=>{
 const updated=mergeObjectivesIntoPromotion({...raw,type:"sin_clasificar",statusSource:"automatic"},
  {cns:raw.cns,targets:{"1":20}},new Date("2026-11-06T12:00:00Z"));
 assert.equal(updated.status,"Borrador");
 assert.equal(updated.statusSource,"manual");
});
