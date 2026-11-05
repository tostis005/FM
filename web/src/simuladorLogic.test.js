import test from "node:test";
import assert from "node:assert/strict";
import {simulatorPeriods,validSimulatorPeriod,simulatorTarget} from "./simuladorLogic.js";

test("cuatro períodos y ningún trimestre; seleccionable el rango libre",()=>{
 const periods=simulatorPeriods("2026-11-05","2026-10-12","2026-11-02");
 assert.deepEqual(periods.map(p=>p.id),["previous","year","twoYears","custom"]);
 assert.deepEqual(periods.map(p=>[p.from,p.to]),[
  ["2026-10-01","2026-10-31"],
  ["2025-10-01","2025-10-31"],
  ["2024-10-01","2024-10-31"],
  ["2026-10-12","2026-11-02"]
 ]);
});
test("períodos correctos en cambio de año y año bisiesto",()=>{
 const periods=simulatorPeriods("2027-01-05","2026-12-02","2027-01-04");
 assert.deepEqual(periods[0],{id:"previous",label:"Mes anterior",
  from:"2026-12-01",to:"2026-12-31"});
 assert.deepEqual(simulatorPeriods("2024-03-22","","")[0].to,"2024-02-29");
});
test("validar fecha sin aceptar rangos vacíos, inversos o demasiado largos",()=>{
 assert.equal(validSimulatorPeriod("2026-10-01","2026-11-03"),true);
 assert.equal(validSimulatorPeriod("2026-11-03","2026-10-01"),false);
 assert.equal(validSimulatorPeriod("","2026-10-01"),false);
 assert.equal(validSimulatorPeriod("2026-02-29","2026-03-02"),false);
 assert.equal(validSimulatorPeriod("2024-01-01","2026-11-01"),false);
});
test("objetivos redondeados y porcentajes 5, 8, 10, 12 y 14",()=>{
 assert.deepEqual([5,8,10,12,14].map(p=>simulatorTarget(100,p)),[105,108,110,112,114]);
 assert.equal(simulatorTarget(3,5),4);
 assert.equal(simulatorTarget(0,14),0);
 assert.equal(simulatorTarget(-2,10),0);
});
