import test from "node:test";
import assert from "node:assert/strict";
import {suggestedFrequency,planGlobalFrequencies} from "./laboratoryFrequencyPolicy.js";
test("el número de CN únicos globales determina una sola frecuencia",()=>{
 assert.equal(suggestedFrequency(2705),4);
 assert.equal(suggestedFrequency(500),4);
 assert.equal(suggestedFrequency(499),7);
 assert.equal(suggestedFrequency(250),7);
 assert.equal(suggestedFrequency(249),14);
 assert.equal(suggestedFrequency(120),14);
 assert.equal(suggestedFrequency(119),null);
 assert.equal(suggestedFrequency(0),null);
 assert.throws(()=>suggestedFrequency(-1));
});
test("propuesta no confunde empresas internas, mayoristas ni servicios con laboratorios",()=>{
 const p=planGlobalFrequencies([
  {id:"1117",name:"CINFA",cn:2705},
  {id:"2",name:"AMPEDIA NUEVA S.L.",cn:349},
  {id:"1132",name:"FARMAMODA",cn:252},
  {id:"381",name:"ORTOPEDIA MOGAR S.A.",cn:105},
  {id:"1197",name:"RATIOPHARM",cn:769}
 ]);
 assert.deepEqual(p.map(x=>x.suggested),[4,null,null,null,4]);
});
