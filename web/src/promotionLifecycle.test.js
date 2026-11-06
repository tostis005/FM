import test from "node:test";
import assert from "node:assert/strict";
import {effectivePromotionStatus,promotionDurationMode,promotionReportingEnd,civilToday} from "./promotionLifecycle.js";
const open={id:"P1",source:"Excel: octubre.xlsx",status:"Activa",statusSource:"automatic",
 start:"2026-10-01",end:"",importedOn:"2026-10-02",targets:{"1":5}};
const utc=s=>new Date(s+"T12:00:00Z");
test("campaña hasta agotar stock permanece abierta sin fecha ni aviso a 30 días",()=>{
 const p={...open,durationMode:"stock"};
 assert.equal(promotionDurationMode(p),"stock");
 assert.equal(effectivePromotionStatus(p,utc("2026-11-01")),"Activa");
 assert.equal(effectivePromotionStatus(p,utc("2027-01-01")),"Activa");
 assert.equal(p.end,"");
 assert.equal(promotionReportingEnd(p,utc("2026-11-15")),"2026-11-15");
});
test("las antiguas campañas sin fin tampoco entran en revisión de vigencia",()=>{
 assert.equal(effectivePromotionStatus(open,utc("2026-12-05")),"Activa");
 assert.equal(promotionReportingEnd(open,utc("2026-12-05")),"2026-12-05");
 assert.equal(promotionDurationMode({...open,endRaw:"Hasta agotar existencias"}),"stock");
 assert.equal(promotionDurationMode({...open,endRaw:"Hasta nuevo aviso"}),"dates");
 assert.equal(promotionDurationMode({...open,end:"2026-12-31"}),"dates");
});
test("una campaña abierta se cierra en su fecha real de finalización",()=>{
 const closed={...open,durationMode:"stock",closedOn:"2026-10-29",closedAt:"2026-10-29T10:00:00Z"};
 assert.equal(effectivePromotionStatus(closed,utc("2026-10-29")),"Finalizada");
 assert.equal(promotionReportingEnd(closed,utc("2026-11-15")),"2026-10-29");
});
test("campañas por fechas caducan automáticamente; futuras quedan en borrador",()=>{
 const p={...open,durationMode:"dates",end:"2026-10-31"};
 assert.equal(effectivePromotionStatus(p,utc("2026-10-31")),"Activa");
 assert.equal(effectivePromotionStatus(p,utc("2026-11-01")),"Finalizada");
 assert.equal(effectivePromotionStatus({...p,start:"2026-12-01",end:"2026-12-31"},utc("2026-11-01")),"Borrador");
});
test("las importaciones sin objetivos permanecen borrador sin revisión periódica",()=>{
 const p={...open,targets:{}};
 assert.equal(effectivePromotionStatus(p,utc("2026-10-15")),"Borrador");
 assert.equal(effectivePromotionStatus(p,utc("2026-12-01")),"Borrador");
});
test("la fecha de la farmacia no depende del día UTC",()=>{
 assert.equal(civilToday(new Date("2026-10-31T23:30:00Z"),"Europe/Madrid"),"2026-11-01");
 assert.equal(civilToday(new Date("2026-10-31T23:30:00Z"),"America/Bogota"),"2026-10-31");
});
