import test from "node:test";
import assert from "node:assert/strict";
import {effectivePromotionStatus,promotionReportingEnd,promotionDurationMode,civilToday} from "./promotionLifecycle.js";
const utc=s=>new Date(s+"T12:00:00Z");
const stock={id:"P1",status:"Activa",statusSource:"automatic",
 durationMode:"stock",start:"2026-10-01",end:"",targets:{"1":5}};

test("stock: sin fecha final ni avisos cada 30 días",()=>{
 assert.equal(promotionDurationMode(stock),"stock");
 for(const date of ["2026-10-31","2026-11-01","2026-12-05","2027-08-11"]){
  assert.equal(effectivePromotionStatus(stock,utc(date)),"Activa");
  assert.equal(promotionReportingEnd(stock,utc(date)),date);
 }
 assert.equal(stock.end,"");
});

test("una campaña por fechas termina según su fecha final",()=>{
 const p={...stock,durationMode:"dates",end:"2026-10-31"};
 assert.equal(effectivePromotionStatus(p,utc("2026-09-30")),"Borrador");
 assert.equal(effectivePromotionStatus(p,utc("2026-10-31")),"Activa");
 assert.equal(effectivePromotionStatus(p,utc("2026-11-01")),"Finalizada");
 assert.equal(promotionReportingEnd(p,utc("2026-11-15")),"2026-10-31");
});

test("una campaña por fechas activa manualmente también termina al vencer",()=>{
 const p={...stock,durationMode:"dates",statusSource:"manual",end:"2026-10-31"};
 assert.equal(effectivePromotionStatus(p,utc("2026-11-01")),"Finalizada");
 assert.equal(effectivePromotionStatus({...p,status:"Borrador"},utc("2026-10-25")),"Borrador");
});

test("los estados de revisión antiguos desaparecen sin perder la campaña",()=>{
 const previous={...stock,status:"Pendiente de revisión",statusSource:"automatic",
  lastConfirmedOn:"2026-10-02"};
 assert.equal(effectivePromotionStatus(previous,utc("2027-01-01")),"Activa");
 const legacy={...previous,durationMode:undefined};
 assert.equal(promotionDurationMode(legacy),"stock");
 assert.equal(effectivePromotionStatus(legacy,utc("2027-01-01")),"Activa");
});

test("cerrar una promoción hasta agotar stock detiene su período",()=>{
 const closed={...stock,closedOn:"2026-11-08",closedAt:"2026-11-08T10:00:00Z"};
 assert.equal(effectivePromotionStatus(closed,utc("2026-11-11")),"Finalizada");
 assert.equal(promotionReportingEnd(closed,utc("2026-11-15")),"2026-11-08");
});

test("las importaciones sin objetivos permanecen en borrador",()=>{
 const p={...stock,targets:{}};
 assert.equal(effectivePromotionStatus(p,utc("2026-11-25")),"Borrador");
});

test("la fecha de la farmacia no depende del día UTC",()=>{
 assert.equal(civilToday(new Date("2026-10-31T23:30:00Z"),"Europe/Madrid"),"2026-11-01");
 assert.equal(civilToday(new Date("2026-10-31T23:30:00Z"),"America/Bogota"),"2026-10-31");
});
