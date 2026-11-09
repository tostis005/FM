import test from "node:test";
import assert from "node:assert/strict";
import {promotionObjectiveMonths,preferredObjectiveMonth,objectiveMonthDates,
 objectiveTargetsForMonth,objectiveTargetsForPeriod,historicPeriodAvailable,
 hasGoalInMonth,objectiveHistoryAnchor} from "./promotionMonthlyObjectives.js";
import {objectiveDraftSelection,mergeObjectivesIntoPromotion} from "./promotionObjectiveFlow.js";
import {simulatorPeriods} from "./simuladorLogic.js";

const base={id:"P",name:"Dr Brown",start:"2026-10-01",end:"2026-12-15",
 status:"Activa",cns:["123456"],targets:{"1":110,"2":20},objectiveBaseline:"previous",
 objectiveRates:{"1":10,"2":5}};
test("objetivos separados por meses naturales, acotados a la campaña",()=>{
 assert.deepEqual(promotionObjectiveMonths(base),["2026-10","2026-11","2026-12"]);
 assert.deepEqual(objectiveMonthDates(base,"2026-11"),{from:"2026-11-01",to:"2026-11-30"});
 assert.deepEqual(objectiveMonthDates(base,"2026-12"),{from:"2026-12-01",to:"2026-12-15"});
 assert.equal(objectiveMonthDates(base,"2027-01"),null);
 assert.equal(preferredObjectiveMonth(base,"2026-11"),"2026-11");
});
test("los históricos mantienen exactamente mes anterior y mismo mes de los dos años anteriores",()=>{
 const periods=simulatorPeriods(objectiveHistoryAnchor("2027-01","2026-11-09"),
  "2026-11-01","2026-11-09");
 assert.deepEqual(periods.slice(0,3).map(p=>[p.from,p.to]),[
  ["2026-12-01","2026-12-31"],["2026-01-01","2026-01-31"],["2025-01-01","2025-01-31"]]);
 assert.equal(historicPeriodAvailable(periods[0],"2026-11-09"),false);
 assert.equal(historicPeriodAvailable(periods[1],"2026-11-09"),true);
 assert.equal(historicPeriodAvailable(periods[3],"2026-11-09"),true);
});
test("conserva porcentaje elegido y última unidad manual para cada farmacia/mes",()=>{
 const nov=mergeObjectivesIntoPromotion(base,{
  cns:base.cns,objectiveMonth:"2026-11",targets:{"1":125,"2":33},
  objectiveBaseline:"previous",objectiveBaselineRange:{from:"2026-10-01",to:"2026-10-31"},
  objectiveRates:{"1":10,"2":5}
 });
 assert.deepEqual(nov.monthlyObjectives["2026-11"].targets,{"1":125,"2":33});
 const restored=objectiveDraftSelection(nov,[{id:1},{id:2}],"2026-11");
 assert.equal(restored.rateByPharmacy["1"],10);
 assert.equal(restored.targets["1"],125);
 assert.equal(restored.targets["2"],33);
 const dec=mergeObjectivesIntoPromotion(nov,{
  cns:base.cns,objectiveMonth:"2026-12",targets:{"1":67,"2":8},
  objectiveBaseline:"year",objectiveRates:{"1":14,"2":20}
 });
 assert.equal(dec.monthlyObjectives["2026-11"].targets["1"],125);
 assert.equal(dec.monthlyObjectives["2026-11"].objectiveRates["1"],10);
 assert.equal(dec.monthlyObjectives["2026-12"].targets["1"],67);
 assert.deepEqual(objectiveTargetsForMonth(dec,"2026-11"),{"1":125,"2":33});
 assert.deepEqual(objectiveTargetsForPeriod(dec),{"1":192,"2":41});
 assert.deepEqual(objectiveTargetsForPeriod(dec,"2026-10"),{});
 assert.equal(hasGoalInMonth(dec,"2026-10"),false);
});
test("objetivos heredados sin mes no se borran ni se migran implícitamente",()=>{
 assert.deepEqual(objectiveTargetsForMonth(base,"2026-11"),{"1":110,"2":20});
 const inFuture=mergeObjectivesIntoPromotion(base,{
  cns:base.cns,objectiveMonth:"2026-12",targets:{"1":90},
  objectiveBaseline:"previous",objectiveRates:{"1":10}
 });
 assert.deepEqual(inFuture.targets,base.targets);
 assert.deepEqual(objectiveTargetsForMonth(inFuture,"2026-11"),{});
 assert.deepEqual(objectiveTargetsForMonth(inFuture,"2026-12"),{"1":90});
});
