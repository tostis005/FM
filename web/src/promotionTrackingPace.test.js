import test from "node:test";
import assert from "node:assert/strict";
import {objectivePace,trackingColorRows} from "./promotionTrackingPace.js";
const campaign=(sales,more={})=>({
 name:"Campaña noviembre",start:"2026-11-01",end:"2026-11-30",
 targets:{"1":100},sales:{"1":sales},...more
});
test("verde al 25% de ventas si solo ha transcurrido una semana del mes",()=>{
 const p=objectivePace(campaign(25),"1","2026-11","2026-11-07");
 assert.equal(p.pct,25);
 assert.equal(p.elapsedPct,23.3);
 assert.equal(p.pacePct,107.1);
 assert.equal(p.tone,"success");
 assert.equal(p.status,"En ritmo");
 assert.equal(p.elapsedDays,7);
});
test("el mismo 25% es rojo al finalizar el período",()=>{
 const p=objectivePace(campaign(25),"1","2026-11","2026-12-01");
 assert.equal(p.elapsedPct,100);
 assert.equal(p.pacePct,25);
 assert.equal(p.tone,"danger");
 assert.equal(p.status,"Por debajo");
});
test("las promociones futuras no aparecen en rojo sin haber comenzado",()=>{
 const p=objectivePace(campaign(0),"1","2026-11","2026-10-15");
 assert.equal(p.elapsedPct,0);
 assert.equal(p.pacePct,null);
 assert.equal(p.status,"Por comenzar");
 assert.equal(p.tone,"upcoming");
});
test("los objetivos respetan la vigencia parcial de la promoción",()=>{
 const p=objectivePace(campaign(25,{start:"2026-11-15",end:"2026-11-30",targets:{"1":50}}),
  "1","2026-11","2026-11-20");
 assert.equal(p.totalDays,16);
 assert.equal(p.elapsedDays,6);
 assert.equal(p.elapsedPct,37.5);
 assert.equal(p.pct,50);
 assert.equal(p.tone,"success");
});
test("varios meses: comparar contra objetivos esperados de cada mes, no promedio global",()=>{
 const p=campaign(160,{start:"2026-10-01",end:"2026-11-30",targets:{"1":300},
  monthlyObjectives:{
   "2026-10":{targets:{"1":100}},
   "2026-11":{targets:{"1":200}}
  }});
 const total=objectivePace(p,"1","","2026-11-08");
 assert.equal(total.goal,300);
 assert.equal(total.elapsedDays,39);
 assert.equal(total.totalDays,61);
 assert.equal(total.expectedUnits,153.3);
 assert.equal(total.tone,"success");
 const nov=objectivePace({...p,sales:{"1":50}},"1","2026-11","2026-11-08");
 assert.equal(nov.goal,200);
 assert.equal(nov.elapsedDays,8);
 assert.equal(nov.pct,25);
 assert.equal(nov.pacePct,93.8);
 assert.equal(nov.tone,"warning");
});
test("mes sin objetivos no reutiliza ventas de otros meses; las campañas heredadas sí conservan metas",()=>{
 const p=campaign(40,{start:"2026-10-01",end:"2026-12-15",
  monthlyObjectives:{"2026-11":{targets:{"1":100}}}});
 assert.equal(objectivePace(p,"1","2026-10","2026-10-20").goal,0);
 const legacy=objectivePace(campaign(20),"1","2026-11","2026-11-10");
 assert.equal(legacy.goal,100);
});
test("el resultado por farmacia usa el mismo cálculo, sin filtrar indebidamente",()=>{
 const c=campaign(25,{targets:{"1":100,"2":50},sales:{"1":25,"2":10}});
 const rows=trackingColorRows([c],id=>id==="1"?"Abadía":"Europa","pharmacy","2","2026-11","2026-11-07");
 assert.equal(rows.length,1);
 assert.equal(rows[0].pharmacy,"Europa");
 assert.equal(rows[0].goal,50);
 assert.equal(rows[0].tone,"danger");
});
