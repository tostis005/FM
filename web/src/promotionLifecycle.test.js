import test from "node:test";
import assert from "node:assert/strict";
import {effectivePromotionStatus,promotionDurationMode,promotionReportingEnd,civilToday,promotionStatusSourceOnSave} from "./promotionLifecycle.js";
const utc=s=>new Date(s+"T12:00:00Z");
const base={id:"P1",source:"Excel: noviembre.xlsx",status:"Borrador",
 statusSource:"automatic",start:"2026-12-01",end:"2026-12-31",
 cns:["123456"],targets:{"1":10},durationMode:"dates"};

test("publicar hoy una campaña de diciembre la muestra activa sin vender aún",()=>{
 const published={...base,status:"Activa",statusSource:"manual"};
 assert.equal(effectivePromotionStatus(published,utc("2026-11-07")),"Activa");
 assert.equal(effectivePromotionStatus(published,utc("2026-12-15")),"Activa");
 assert.equal(effectivePromotionStatus(published,utc("2027-02-15")),"Activa");
 assert.equal(promotionReportingEnd(published,utc("2026-11-07")),"2026-12-31");
 assert.equal(promotionStatusSourceOnSave(base,published),"manual");
});
test("un borrador de fechas pasadas o de hoy permanece privado hasta publicarlo",()=>{
 assert.equal(effectivePromotionStatus({...base,status:"Borrador",start:"2026-01-01",end:"2026-02-28"},utc("2026-11-07")),"Borrador");
 assert.equal(effectivePromotionStatus({...base,status:"Borrador",start:"2026-11-01",end:"2026-11-30",targets:{"1":50}},utc("2026-11-07")),"Borrador");
 assert.equal(effectivePromotionStatus({...base,status:"Borrador",statusSource:"automatic"},utc("2027-05-01")),"Borrador");
});
test("sin metas ni clasificación el estado se decide por publicación, no por histórico",()=>{
 assert.equal(effectivePromotionStatus({...base,status:"Activa",targets:{},type:"sin_clasificar"},utc("2026-11-07")),"Activa");
 assert.equal(effectivePromotionStatus({...base,status:"Borrador",targets:{"1":50}},utc("2026-11-07")),"Borrador");
});
test("archivar manualmente cierra la publicación; la fecha fin sola no la archiva",()=>{
 const published={...base,status:"Activa",start:"2026-10-01",end:"2026-10-31"};
 assert.equal(effectivePromotionStatus(published,utc("2026-11-07")),"Activa");
 assert.equal(effectivePromotionStatus({...published,status:"Finalizada"},utc("2026-11-07")),"Finalizada");
 assert.equal(effectivePromotionStatus({...published,closedOn:"2026-10-20"},utc("2026-11-07")),"Finalizada");
 assert.equal(promotionReportingEnd({...published,closedOn:"2026-10-20"},utc("2026-11-07")),"2026-10-20");
});
test("el guardado mantiene origen automático si solo se edita contenido, no publicación",()=>{
 assert.equal(promotionStatusSourceOnSave(base,{...base,name:"Nueva descripción"}),"automatic");
 assert.equal(promotionStatusSourceOnSave(base,{...base,status:"Activa"}),"manual");
 assert.equal(promotionStatusSourceOnSave({...base,status:"Activa",statusSource:"manual"},{...base,status:"Borrador"}),"manual");
 assert.equal(promotionStatusSourceOnSave(null,{...base,status:"Activa"}),"manual");
});
test("campañas hasta agotar stock no caducan por calendario",()=>{
 const p={...base,durationMode:"stock",start:"2025-01-01",end:"",status:"Activa"};
 assert.equal(promotionDurationMode(p),"stock");
 assert.equal(effectivePromotionStatus(p,utc("2027-01-01")),"Activa");
 assert.equal(promotionReportingEnd(p,utc("2026-11-15")),"2026-11-15");
});
test("importaciones antiguas con estado desconocido son privadas hasta revisión",()=>{
 assert.equal(effectivePromotionStatus({...base,status:"Pendiente de revisión"}),"Borrador");
 assert.equal(effectivePromotionStatus({...base,status:""}),"Borrador");
 assert.equal(effectivePromotionStatus({...base,status:null}),"Borrador");
});
test("el día de farmacia usa su zona horaria local",()=>{
 assert.equal(civilToday(new Date("2026-10-31T23:30:00Z"),"Europe/Madrid"),"2026-11-01");
 assert.equal(civilToday(new Date("2026-10-31T23:30:00Z"),"America/Bogota"),"2026-10-31");
});
