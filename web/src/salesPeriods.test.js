import test from "node:test";
import assert from "node:assert/strict";
import {resolveSalesPeriod,formatSalesBucket,SALES_PERIODS} from "./salesPeriods.js";
const now=new Date("2026-10-18T08:00:00Z"); // Domingo 18/10/2026
const resolve=p=>resolveSalesPeriod(p,now,{},"Europe/Madrid");
test("períodos cortos respetan lunes y frontera de mes",()=>{
 assert.deepEqual([resolve("today").from,resolve("today").to,resolve("today").granularity],["2026-10-18","2026-10-18","hour"]);
 assert.equal(resolve("yesterday").from,"2026-10-17");
 assert.deepEqual([resolve("this_week").from,resolve("this_week").to],["2026-10-12","2026-10-18"]);
 assert.deepEqual([resolve("last_week").from,resolve("last_week").to],["2026-10-05","2026-10-11"]);
 assert.deepEqual([resolve("this_month").from,resolve("this_month").to],["2026-10-01","2026-10-18"]);
 assert.deepEqual([resolve("last_month").from,resolve("last_month").to],["2026-09-01","2026-09-30"]);
 assert.equal(resolve("last_7").from,"2026-10-12");
 assert.equal(resolve("last_30").from,"2026-09-19");
 assert.deepEqual([resolve("3").from,resolve("6").from,resolve("12").from],["2026-08-01","2026-05-01","2025-11-01"]);
});
test("mismo instante respeta zona horaria al cruzar medianoche",()=>{
 const edge=new Date("2026-10-18T22:30:00Z");
 assert.equal(resolveSalesPeriod("today",edge,{},"Europe/Madrid").from,"2026-10-19");
 assert.equal(resolveSalesPeriod("today",edge,{},"America/El_Salvador").from,"2026-10-18");
});
test("personalizado valida el rango y escoge puntos horarios, diarios o mensuales",()=>{
 const v=(a,b)=>resolveSalesPeriod("custom",now,{from:a,to:b});
 assert.deepEqual([v("2026-10-04","2026-10-04").granularity,v("2026-10-01","2026-10-18").granularity,v("2026-01-01","2026-10-18").granularity],["hour","day","month"]);
 assert.equal(v("2026-10-19","2026-10-01").valid,false);
 assert.equal(v("2026-02-30","2026-03-01").valid,false);
 assert.equal(v("2023-01-01","2026-01-01").valid,true);
 assert.equal(v("1900-01-01","2026-10-18").valid,false);
 assert.equal(v("","2026-10-18").valid,false);
 assert.equal(SALES_PERIODS.length,17);
 assert.equal(formatSalesBucket("2026-10-18T09:00","hour"),"09:00");
 assert.equal(formatSalesBucket("2026-10-18","day"),"18/10");
});

test("períodos históricos de dos, tres, cinco años y todo el registro",()=>{
 assert.equal(resolve("24").from,"2024-11-01");
 assert.equal(resolve("36").from,"2023-11-01");
 assert.equal(resolve("60").from,"2021-11-01");
 assert.equal(resolve("all").from,"1900-01-01");
 assert.equal(resolve("all").granularity,"month");
});

test("Este año empieza en enero, termina hoy y mantiene zona horaria local",()=>{
 const current=resolve("this_year");
 assert.deepEqual([current.from,current.to,current.granularity],["2026-01-01","2026-10-18","month"]);
 const newYear=new Date("2027-01-01T00:30:00Z");
 assert.equal(resolveSalesPeriod("this_year",newYear,{},"America/El_Salvador").from,"2026-01-01");
 assert.equal(resolveSalesPeriod("this_year",newYear,{},"Europe/Madrid").from,"2027-01-01");
 assert.ok(SALES_PERIODS.some(([key,label])=>key==="this_year"&&label==="Este año"));
});
