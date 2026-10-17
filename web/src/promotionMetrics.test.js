import test from "node:test";
import assert from "node:assert/strict";
import {promotionMetrics} from "./promotionMetrics.js";
test("cuenta promociones importadas en borrador, CN y objetivos",()=>{
 const data=[{id:"X1",status:"Borrador",cns:["001474","164432"],targets:{"1":20,"2":15},sales:{"1":5,"2":3}},
  {id:"X2",status:"Finalizada",cns:["001474","195598"],targets:{"1":10},sales:{"1":4}}];
 const unavailable=promotionMetrics(data,false);
 assert.deepEqual(unavailable,{promotions:2,cnCount:3,target:45,units:null,completion:null});
 const loaded=promotionMetrics(data,true);
 assert.deepEqual(loaded,{promotions:2,cnCount:3,target:45,units:12,completion:27});
});
test("sin ventas no afirma cero; conectado sin ventas sí representa cero",()=>{
 const rows=[{id:"P1",cns:["000001"],targets:{"1":10},sales:{}}];
 assert.equal(promotionMetrics(rows,false).units,null);
 assert.equal(promotionMetrics(rows,true).units,0);
 assert.equal(promotionMetrics(rows,true).completion,0);
 assert.equal(promotionMetrics([],true).completion,null);
});
test("filtra solo entradas de la lista y evita NaN y vacíos como objetivos",()=>{
 const rows=[{id:"A",cns:["012345"],targets:{"1":"","2":"10","3":"mal"},sales:{"2":-2}},
 {id:"B",cns:["432100"],targets:{"1":500},sales:{"1":200}}];
 assert.deepEqual(promotionMetrics(rows.slice(0,1),true),{promotions:1,cnCount:1,target:10,units:-2,completion:-20});
});

test("Excel de octubre: las promociones con objetivos cuentan aunque estén en borrador",async()=>{
 const {REAL_OCTOBER_EXAMPLES}=await import("./promocionesRealesOctubre.js");
 const {OCTOBER_2026_OBJECTIVE_ROWS}=await import("./objetivosOctubre2026.js");
 const {applyObjectiveRows}=await import("./objetivosImportacion.js");
 const campaigns=applyObjectiveRows(REAL_OCTOBER_EXAMPLES,OCTOBER_2026_OBJECTIVE_ROWS).promotions;
 assert.ok(campaigns.length>=10);
 assert.ok(campaigns.every(p=>p.status==="Borrador"));
 const metrics=promotionMetrics(campaigns,false);
 assert.equal(metrics.promotions,campaigns.length);
 assert.ok(metrics.cnCount>30);
 assert.ok(metrics.target>0,"Los objetivos del Excel deben reflejarse en el resumen");
 assert.equal(metrics.units,null);
});
