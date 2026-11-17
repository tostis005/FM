import test from "node:test";
import assert from "node:assert/strict";
import {planGenericSalesSources} from "./genericOfferSalesSources.js";

const pharmacies=[{id:1,code:"ABA"},{id:2,code:"NOR"}];
test("12 meses: usa cierres confirmados y lee solo noviembre en el ERP",()=>{
 const closures=[];
 for(let m=1;m<=10;m++){
  const month="2026-"+String(m).padStart(2,"0")+"-01";
  closures.push({farmacia_id:1,mes:month},{farmacia_id:2,mes:month});
 }
 const plan=planGenericSalesSources("2026-01-01","2026-11-17","2026-11-17",
  pharmacies,closures);
 assert.equal(plan.cached.length,20);
 assert.deepEqual(plan.raw,[{from:"2026-11-01",to:"2026-11-17",codes:["ABA","NOR"]}]);
});
test("si falta el cierre en una farmacia, lee ese mes sin duplicar la farmacia cerrada",()=>{
 const plan=planGenericSalesSources("2026-09-01","2026-11-17","2026-11-17",
  pharmacies,[
   {farmacia_id:1,mes:"2026-09-01"},
   {farmacia_id:2,mes:"2026-09-01"},
   {farmacia_id:1,mes:"2026-10-01"}
  ]);
 assert.deepEqual(plan.cached,[
  {id:1,month:"2026-09-01"},{id:2,month:"2026-09-01"},
  {id:1,month:"2026-10-01"}
 ]);
 assert.deepEqual(plan.raw,[
  {from:"2026-11-01",to:"2026-11-17",codes:["ABA"]},
  {from:"2026-10-01",to:"2026-11-17",codes:["NOR"]}
 ]);
});
test("sin cierres: fusiona el histórico sin agujeros, incluso con fechas parciales",()=>{
 assert.deepEqual(planGenericSalesSources("2026-01-15","2026-03-12",
  "2026-03-12",pharmacies,[]).raw,
 [{from:"2026-01-15",to:"2026-03-12",codes:["ABA","NOR"]}]);
});
test("no utiliza como cerrado un mes futuro ni el mes actual",()=>{
 const plan=planGenericSalesSources("2026-11-01","2026-11-17","2026-11-17",
  [pharmacies[0]],[{farmacia_id:1,mes:"2026-11-01"}]);
 assert.deepEqual(plan.cached,[]);
 assert.deepEqual(plan.raw,[{from:"2026-11-01",to:"2026-11-17",codes:["ABA"]}]);
});
