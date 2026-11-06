import test from "node:test";
import assert from "node:assert/strict";
import {splitPromotionSalesPeriod} from "./promotionSalesRanges.js";

test("campaña por fechas de un mes conserva el intervalo único",()=>{
 assert.deepEqual(splitPromotionSalesPeriod("2026-11-01","2026-11-30"),[
  {start:"2026-11-01",end:"2026-11-30"}
 ]);
});

test("stock hasta agotarse: periodos consecutivos sin caducidad ficticia",()=>{
 const parts=splitPromotionSalesPeriod("2025-01-01","2027-01-01");
 assert.equal(parts.length,3);
 assert.equal(parts[0].start,"2025-01-01");
 assert.equal(parts.at(-1).end,"2027-01-01");
 for(let i=0;i<parts.length;i++){
  const a=Date.parse(parts[i].start+"T00:00:00Z");
  const b=Date.parse(parts[i].end+"T00:00:00Z");
  assert.ok((b-a)/86400000<=365,"El servidor admite como máximo 366 días inclusivos");
  if(i>0){
   const previous=Date.parse(parts[i-1].end+"T00:00:00Z");
   assert.equal(a-previous,86400000,"Sin solapamientos ni días perdidos");
  }
 }
});

test("sin fechas coherentes no consulta ventas",()=>{
 assert.deepEqual(splitPromotionSalesPeriod("2026-11-30","2026-11-01"),[]);
 assert.deepEqual(splitPromotionSalesPeriod("2026-11-31","2026-12-01"),[]);
});
