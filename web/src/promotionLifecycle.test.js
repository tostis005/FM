import test from "node:test";
import assert from "node:assert/strict";
import {effectivePromotionStatus,promotionReviewDue,promotionReportingEnd,civilToday} from "./promotionLifecycle.js";
const open={id:"P1",source:"Excel: octubre.xlsx",status:"Activa",statusSource:"automatic",
 start:"2026-10-01",end:"",importedOn:"2026-10-02",targets:{"1":5}};
const utc=s=>new Date(s+"T12:00:00Z");
test("30 días de calendario desde última confirmación, sin cerrar la promoción",()=>{
 assert.equal(promotionReviewDue(open),"2026-11-01");
 assert.equal(effectivePromotionStatus(open,utc("2026-10-31")),"Activa");
 assert.equal(effectivePromotionStatus(open,utc("2026-11-01")),"Pendiente de revisión");
 assert.equal(open.end,"","el plazo de revisión no inventa una fecha de fin");
 assert.equal(promotionReportingEnd(open,utc("2026-11-15")),"2026-10-31");
});
test("confirmación renueva la revisión 30 días y mantiene el historial",()=>{
 const confirmed={...open,lastConfirmedOn:"2026-11-05",lastConfirmedAt:"2026-11-05T12:00:00Z"};
 assert.equal(effectivePromotionStatus(confirmed,utc("2026-11-20")),"Activa");
 assert.equal(effectivePromotionStatus(confirmed,utc("2026-12-05")),"Pendiente de revisión");
 assert.equal(promotionReportingEnd(confirmed,utc("2026-11-20")),"2026-11-20");
});
test("cierre manual conserva fecha final real y prima sobre la fecha Excel",()=>{
 const closed={...open,end:"2026-12-31",closedOn:"2026-10-29",closedAt:"2026-10-29T10:00:00Z"};
 assert.equal(effectivePromotionStatus(closed,utc("2026-10-29")),"Finalizada");
 assert.equal(promotionReportingEnd(closed,utc("2026-11-15")),"2026-10-29");
});
test("fechas finitas caducan automáticamente; futuras quedan en borrador",()=>{
 const p={...open,end:"2026-10-31"};
 assert.equal(effectivePromotionStatus(p,utc("2026-10-31")),"Activa");
 assert.equal(effectivePromotionStatus(p,utc("2026-11-01")),"Finalizada");
 assert.equal(effectivePromotionStatus({...p,start:"2026-12-01",end:"2026-12-31"},utc("2026-11-01")),"Borrador");
});
test("las importaciones sin objetivos también piden revisión",()=>{
 const p={...open,targets:{}};
 assert.equal(effectivePromotionStatus(p,utc("2026-10-15")),"Borrador");
 assert.equal(effectivePromotionStatus(p,utc("2026-11-01")),"Pendiente de revisión");
});
test("la fecha de la farmacia no depende del día UTC",()=>{
 assert.equal(civilToday(new Date("2026-10-31T23:30:00Z"),"Europe/Madrid"),"2026-11-01");
 assert.equal(civilToday(new Date("2026-10-31T23:30:00Z"),"America/Bogota"),"2026-10-31");
});
