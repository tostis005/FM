import test from "node:test";
import assert from "node:assert/strict";
import {compatibleDailyRange,buildDashboardMonthSQL} from "./dashboardConsolidations.js";
import {createDashboardDailyService} from "./dashboardDailyService.js";

test("ventanas diarias cubren semana pasada, mes pasado y actual sin cachear futuro",()=>{
 const today="2026-10-26";
 const month=compatibleDailyRange("2026-09-01","2026-09-30",today);
 assert.equal(month.days,30);assert.equal(month.live,false);
 const week=compatibleDailyRange("2026-10-12","2026-10-18",today);
 assert.equal(week.days,7);assert.equal(week.live,false);
 const thisWeek=compatibleDailyRange("2026-10-26","2026-10-26",today);
 assert.equal(thisWeek.days,0);assert.equal(thisWeek.live,true);
 const currentMonth=compatibleDailyRange("2026-10-01","2026-10-26",today);
 assert.equal(currentMonth.days,25);assert.equal(currentMonth.live,true);
 assert.equal(compatibleDailyRange("2026-05-01","2026-05-31",today),null);
 assert.equal(compatibleDailyRange("2026-10-01","2026-10-27",today),null);
});
test("SQL diario usa las mismas devoluciones y documento completo y aprovecha índice",()=>{
 for(const source of ["ventas","compras"]){
  const sql=buildDashboardMonthSQL("ampedia",source,{daily:true});
  assert.match(sql,/generate_series\(\$2::date,\$3::date-interval '1 day',interval '1 day'\)/);
  assert.match(sql,/SELECT f\.id AS farmacia_id,day\.dia::date AS dia/);
  assert.match(sql,/h\.farmacia_codigo=f\.code AND h\.fecha >= day\.dia/);
  assert.match(sql,/h\.fecha < day\.dia \+ interval '1 day' AND h\.lineas_completas/);
  assert.match(sql,/NOT l\.eliminada_logicamente/);
  assert.match(sql,/l\.devuelta IS TRUE/);
  assert.doesNotMatch(sql,/upper\(btrim\(h\.farmacia_codigo\)\)/);
 }
});
test("un día o una farmacia no precargados no aparecen como importe cero",async()=>{
 let calls=0;
 const pool={query:async()=>{calls++;return {rows:[]}}};
 const service=createDashboardDailyService(pool,{
  sourceScopes:async()=>[],now:()=>new Date("2026-10-26T12:00:00Z")});
 const result=await service.readDays({slug:"ampedia",schema:"ampedia",
  ids:[1,2],farms:[{id:1,code:"ABA"},{id:2,code:"EUR"}],
  from:"2026-10-12",to:"2026-10-18"});
 assert.equal(result.available,false);
 assert.equal(result.reason,"daily-pending");
 assert.equal(result.expectedRows,28);
 assert.equal(calls,1);
});
test("no se lanza precarga en el día abierto ni en meses futuros",async()=>{
 const pool={connect:async()=>{throw Error("No debe conectar")}};
 const service=createDashboardDailyService(pool,{
  sourceScopes:async()=>[],now:()=>new Date("2026-10-01T12:00:00Z")});
 assert.equal(await service.refreshDays({slug:"ampedia",schema:"ampedia",
  farms:[{id:1,code:"ABA"}],month:"2026-10-01"}),false);
 assert.equal(await service.refreshDays({slug:"ampedia",schema:"ampedia",
  farms:[{id:1,code:"ABA"}],month:"2026-11-01"}),false);
});
