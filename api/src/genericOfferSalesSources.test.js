import test from "node:test";
import assert from "node:assert/strict";
import {planGenericSalesSources,planGenericOpportunitySources,genericSalesRollup} from "./genericOfferSalesSources.js";

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
  {from:"2026-10-01",to:"2026-11-17",codes:["NOR"]},
  {from:"2026-11-01",to:"2026-11-17",codes:["ABA"]}
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

test("ventanas de oportunidades conservan los límites de un período personalizado",()=>{
 const closures=["2026-01-01","2026-02-01","2026-03-01","2026-04-01"].map(mes=>({farmacia_id:1,mes}));
 const plan=planGenericOpportunitySources("2026-02-15","2026-03-10","2026-04-20","2026-01-01","2026-02-01",[pharmacies[0]],closures);
 assert.deepEqual(plan.cached,[{id:1,month:"2026-01-01"}]);
 assert.deepEqual(plan.raw,[{from:"2026-02-01",to:"2026-04-20",codes:["ABA"]}]);
 const exact=planGenericOpportunitySources("2026-02-15","2026-03-10","2026-04-20","2026-01-01","2026-02-01",[pharmacies[0]],closures,false);
 assert.deepEqual(exact.cached,[]);
 assert.deepEqual(exact.raw,[{from:"2026-02-15",to:"2026-03-10",codes:["ABA"]}]);
});
test("SQL de ventas combina cierres y solo tramos pendientes, conserva importe y alcance",async()=>{
 const pool={query:async q=>{
  const t=typeof q==="string"?q:q.text;
  if(t.includes("current_date::text"))return {rows:[{today:"2026-11-17",annual:"2026-01-01",quarter:"2026-09-01"}]};
  if(t.includes("meses_cerrados"))return {rows:Array.from({length:10},(_,i)=>({farmacia_id:1,mes:"2026-"+String(i+1).padStart(2,"0")+"-01"}))};
  return {rows:[pharmacies[0]]};
 }};
 const {cte,values}=await genericSalesRollup(pool,{schema:'"ampedia"',tenant:"ampedia",ids:[1],from:"2026-01-01",to:"2026-11-17",extra:["111",["abc"]],articleParam:6,pharmacyCodeSQL:"f.codigo_origen"});
 assert.match(cte,/ventas_panorama_mensual/);
 assert.match(cte,/fm_ventas_analitica/);
 assert.match(cte,/m\.importe/);
 assert.match(cte,/v\.importe/);
 assert.match(cte,/m\.clave=ANY\(\$6::text\[\]\)/);
 assert.match(cte,/v\.articulo_id=ANY\(\$6::text\[\]\)/);
 assert.deepEqual(values.slice(0,6),["ampedia",[1],"2026-01-01","2026-11-17","111",["abc"]]);
 assert.deepEqual(values.slice(-3),["2026-11-01","2026-11-17",["ABA"]]);
 assert.equal(values[6].length,10);
});
