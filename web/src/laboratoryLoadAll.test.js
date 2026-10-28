import test from "node:test";
import assert from "node:assert/strict";
import {collectLaboratoryMetrics,LAB_METRICS_BATCH,LAB_METRICS_CONCURRENCY,LAB_VISIBLE_INITIAL,visibleLaboratoryRows,nextLaboratoryVisibleCount} from "./laboratoryLoadAll.js";

test("dos mil CN se calculan en diez lotes, máximo tres consultas simultáneas",async()=>{
 const initial=Array.from({length:2000},(_,i)=>({
  referencia:String(400000+i),cn:String(400000+i),nombre:"Artículo "+i
 }));
 const sizes=[],progress=[];
 let concurrent=0,maxConcurrent=0;
 const result=await collectLaboratoryMetrics(initial,async items=>{
  sizes.push(items.length);
  concurrent++;maxConcurrent=Math.max(maxConcurrent,concurrent);
  await new Promise(resolve=>setTimeout(resolve,2));
  concurrent--;
  return {frequencyDays:7,rows:items.map(x=>({
   referencia:x.referencia,byPharmacy:{"1":{stock:3,units3:12,units12:48,
    unitsPeriod:5,suggested:1}},totalSold:5,totalSuggested:1
  }))};
 },{onBatch:x=>progress.push(x.loaded)});
 assert.equal(LAB_METRICS_BATCH,200);
 assert.equal(LAB_METRICS_CONCURRENCY,3);
 assert.equal(sizes.length,10,"2.000 referencias no generan cincuenta consultas");
 assert.ok(sizes.every(n=>n===200));
 assert.ok(maxConcurrent<=3);
 assert.ok(maxConcurrent>=2);
 assert.equal(result.rows.length,2000);
 assert.ok(result.rows.every(x=>x.metricsReady===true));
 assert.equal(Math.max(...progress),2000);
 assert.equal(new Set(result.rows.map(x=>x.referencia)).size,2000);
});

test("si falta una referencia no se considera completo el cálculo",async()=>{
 await assert.rejects(()=>collectLaboratoryMetrics([
  {referencia:"400001",cn:"400001"},
  {referencia:"400002",cn:"400002"}
 ],async()=>({rows:[{referencia:"400001"}]})),/Faltan referencias/);
});

test("al abortar no se publican resultados de cálculos antiguos",async()=>{
 const controller=new AbortController();
 await assert.rejects(()=>collectLaboratoryMetrics([
  {referencia:"400001",cn:"400001"}
 ],async()=>{controller.abort();return {rows:[]}},{
  signal:controller.signal,onBatch:()=>assert.fail("No publicar tras abortar")
 }),{name:"AbortError"});
});

test("dibujar 150 filas no trunca 2.000 referencias ni modifica los cálculos",()=>{
 const rows=Array.from({length:2000},(_,i)=>({referencia:String(400000+i),totalSold:1,totalSuggested:2}));
 const first=visibleLaboratoryRows(rows);
 assert.equal(LAB_VISIBLE_INITIAL,150);
 assert.equal(first.length,150);
 assert.equal(rows.length,2000);
 assert.equal(rows.reduce((total,row)=>total+row.totalSold,0),2000);
 assert.equal(rows.reduce((total,row)=>total+row.totalSuggested,0),4000);
 assert.equal(nextLaboratoryVisibleCount(150,2000),300);
 assert.equal(visibleLaboratoryRows(rows,nextLaboratoryVisibleCount(150,2000)).length,300);
 assert.equal(nextLaboratoryVisibleCount(1950,2000),2000);
 assert.equal(visibleLaboratoryRows(rows,2000).length,rows.length);
 assert.equal(visibleLaboratoryRows(rows,0).length,0);
});
