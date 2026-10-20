import test from "node:test";
import assert from "node:assert/strict";
import {promotionImportIdentity,planPromotionImport} from "./promotionImportIdentity.js";
const promo={id:"X123",name:"Línea corporal · 3x2",
 laboratory:"Laboratorio Éste",range:"Línea corporal",originalOffer:"3x2",
 description:"Crema hidratante",start:"2026-10-01",end:"2026-10-31",
 cns:["123456"],targets:{"1":7}};
test("la misma promoción del mismo año no sobreescribe objetivos ni CN",()=>{
 const incoming={...promo,id:"XOTHER",laboratory:" LABORATORIO ESTE ",
  targets:{"1":99},cns:["222222"],sourceRow:22};
 const r=planPromotionImport([promo],[incoming]);
 assert.deepEqual(r,{additions:[],skipped:1});
 assert.equal(promo.targets["1"],7);
});
test("diferencias de año, oferta y descripción crean campañas distintas",()=>{
 const candidates=[{...promo,id:"A",start:"2027-10-01",end:"2027-10-31"},
  {...promo,id:"B",originalOffer:"2x1"},
  {...promo,id:"C",description:"Sérum reafirmante"}];
 const r=planPromotionImport([promo],candidates);
 assert.equal(r.additions.length,3);
});
test("dos filas idénticas del mismo Excel se crean solo una vez",()=>{
 const r=planPromotionImport([], [promo,{...promo,id:"OTHER",sourceRow:200}]);
 assert.equal(r.additions.length,1);assert.equal(r.skipped,1);
});
test("una colisión técnica de ID no oculta una promoción diferente",()=>{
 const r=planPromotionImport([promo],[{...promo,range:"Otra gama"}]);
 assert.equal(r.additions.length,1);
 assert.equal(r.additions[0].id,"X123-1");
 assert.equal(r.skipped,0);
});
test("diferentes descripciones distinguen campañas que comparten laboratorio, marca, oferta y fechas",()=>{
 const x={...promo,description:"Sérum",id:"SERUM"};
 assert.notEqual(promotionImportIdentity(promo),promotionImportIdentity(x));
 assert.equal(planPromotionImport([promo],[x]).additions.length,1);
});
