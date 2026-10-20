import test from "node:test";
import assert from "node:assert/strict";
import {splitHistoricalYears,loadHistoricalSummary,mergeHistoricalSummaries} from "./historicalSummaries.js";

test("cinco años se reparten sin solapamientos ni días perdidos",()=>{
 const windows=splitHistoricalYears("2021-11-01","2026-10-20");
 assert.equal(windows.length,6);
 assert.deepEqual(windows[0],{from:"2021-11-01",to:"2021-12-31"});
 assert.deepEqual(windows[1],{from:"2022-01-01",to:"2022-12-31"});
 assert.deepEqual(windows.at(-1),{from:"2026-01-01",to:"2026-10-20"});
});
test("sumatorios de ventas y margen ponderado conservan cobertura de costes",()=>{
 const value=(month,ventas,margin,complete=true)=>({
  monthly:[{month,ventas,unidades:10}],kpis:{ventas,unidades:10},
  costBasis:{products:10,priced:complete?10:7,coveredSales:ventas,margin}
 });
 const full=mergeHistoricalSummaries([value("2025-01",200,50),
  value("2026-01",100,20)],"sales",{from:"2025-01-01",to:"2026-01-31"});
 assert.deepEqual(full.kpis,{ventas:300,unidades:20,margen:70,margenPct:23.33,coberturaCostes:100});
 const incomplete=mergeHistoricalSummaries([value("2025-01",200,50),
  value("2026-01",100,20,false)],"sales",{from:"2025-01-01",to:"2026-01-31"});
 assert.equal(incomplete.kpis.margen,null,"No extrapolar costes inexistentes");
 assert.equal(incomplete.kpis.margenPct,null);
 assert.equal(incomplete.kpis.coberturaCostes,85);
});
test("compras reales se suman por tramo, nunca se suman proveedores repetidos",()=>{
 const period=(month,compras,units)=>({available:true,sourceRows:2,
  hasArticleLines:true,hasAmounts:true,
  monthly:[{month,compras}],kpis:{compras,unidadesCompradas:units,
   recepciones:2,lineasCompra:2,proveedores:3}});
 const total=mergeHistoricalSummaries([period("2025-01",90,6),period("2026-01",60,4)],
  "purchases",{from:"2025-01-01",to:"2026-01-31"});
 assert.equal(total.kpis.compras,150);
 assert.equal(total.kpis.unidadesCompradas,10);
 assert.equal(total.kpis.recepciones,4);
 assert.equal(total.kpis.proveedores,null);
});
test("histórico consulta dos tramos como máximo a la vez y termina completo",async()=>{
 let concurrent=0,max=0;
 const progress=[];
 const result=await loadHistoricalSummary({from:"2021-11-01",to:"2026-10-20",
  kind:"sales",onProgress:(done,total)=>progress.push([done,total]),
  load:async window=>{
   concurrent++;max=Math.max(max,concurrent);
   await new Promise(resolve=>setTimeout(resolve,1));
   concurrent--;
   return {monthly:[{month:window.to.slice(0,7),ventas:10,unidades:2}],
    costBasis:{priced:2,products:2,coveredSales:10,margin:3},
    kpis:{ventas:10,unidades:2}};
  }});
 assert.equal(max,2);
 assert.equal(result.kpis.ventas,60);
 assert.deepEqual(progress.at(-1),[6,6]);
});
test("errores temporales de un año se reintentan por mitades sin inventar totales",async()=>{
 const requests=[];
 const result=await loadHistoricalSummary({from:"2025-01-01",to:"2025-12-31",kind:"purchases",
  load:async window=>{
   requests.push(window);
   if(window.from==="2025-01-01"&&window.to==="2025-12-31"){
    const error=new Error("statement timeout");error.status=500;throw error;
   }
   return {available:true,monthly:[],sourceRows:2,hasArticleLines:true,
    kpis:{compras:40,unidadesCompradas:5,recepciones:1,lineasCompra:2,proveedores:1}};
  }});
 assert.equal(requests.length,3);
 assert.equal(result.kpis.compras,80);
 assert.equal(result.kpis.proveedores,null);
});
