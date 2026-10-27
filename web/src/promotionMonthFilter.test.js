import test from "node:test";
import assert from "node:assert/strict";
import {currentPromotionMonth,promotionMonthRange,promotionMonthFromRange,promotionOverlapsPeriod} from "./promotionMonthFilter.js";

test("mes actual usa calendario del cliente, no huso del navegador",()=>{
 assert.equal(currentPromotionMonth(new Date("2026-11-01T00:30:00Z"),"Europe/Madrid"),"2026-11");
 assert.equal(currentPromotionMonth(new Date("2026-11-01T00:30:00Z"),"America/New_York"),"2026-10");
});
test("intervalo completo, inclusive y año bisiesto",()=>{
 assert.deepEqual(promotionMonthRange("2026-10"),{from:"2026-10-01",to:"2026-10-31"});
 assert.deepEqual(promotionMonthRange("2024-02"),{from:"2024-02-01",to:"2024-02-29"});
 assert.deepEqual(promotionMonthRange("2025-02"),{from:"2025-02-01",to:"2025-02-28"});
 assert.equal(promotionMonthRange("2026-13"),null);
 assert.equal(promotionMonthFromRange("2026-10-01","2026-10-31"),"2026-10");
 assert.equal(promotionMonthFromRange("2026-10-01","2026-10-27"),"");
});
test("promociones iniciadas, finalizadas y transversales se ven en el mismo mes",()=>{
 const from="2026-10-01",to="2026-10-31";
 const ranges=[
  ["2026-10-20","2026-11-20"],
  ["2026-09-20","2026-10-02"],
  ["2026-09-20","2026-11-20"],
  ["2026-10-01","2026-10-01"],
  ["2026-10-31","2026-10-31"]
 ];
 for(const [start,end] of ranges)assert.equal(promotionOverlapsPeriod({start,end},from,to),true);
 for(const [start,end] of [["2026-09-01","2026-09-30"],["2026-11-01","2026-11-30"]])
  assert.equal(promotionOverlapsPeriod({start,end},from,to),false);
});
test("fechas incompletas no contaminan vistas de mes; todas sí",()=>{
 assert.equal(promotionOverlapsPeriod({start:"",end:""}, "2026-10-01","2026-10-31"),false);
 assert.equal(promotionOverlapsPeriod({start:"2026-10-12",end:"2026-10-01"},"2026-10-01","2026-10-31"),false);
 assert.equal(promotionOverlapsPeriod({start:"",end:""},"",""),true);
 assert.equal(promotionOverlapsPeriod({start:"2026-09-15",end:"2026-10-20"},"2026-10-03","2026-10-05"),true);
});
