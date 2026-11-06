import test from "node:test";
import assert from "node:assert/strict";
import {collectLaboratoryMetrics,fetchLaboratoryMetricsAdaptive,LAB_METRICS_BATCH,LAB_METRICS_CONCURRENCY} from "./laboratoryLoadAll.js";

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

test("métricas: dividir lotes lentos sin perder referencias ni duplicar resultados",async()=>{
 const items=Array.from({length:200},(_,i)=>({referencia:String(400000+i),cn:String(400000+i)}));
 const sizes=[];
 const result=await fetchLaboratoryMetricsAdaptive(items,async batch=>{
  sizes.push(batch.length);
  if(batch.length>50)return {metricsUnavailable:true,metricsErrorCode:"57014",
   warning:"Consulta agotada"};
  return {frequencyDays:7,rows:batch.map(row=>({
   referencia:row.referencia,byPharmacy:{"1":{stock:4,units3:3,units12:12,
    unitsPeriod:2,suggested:1}},totalSold:2,totalSuggested:1
  }))};
 });
 assert.deepEqual(sizes,[200,100,50,50,100,50,50]);
 assert.equal(result.rows.length,200);
 assert.equal(new Set(result.rows.map(row=>row.referencia)).size,200);
 assert.equal(result.rows[199].byPharmacy["1"].stock,4);
});

test("métricas: errores SQL permanentes no provocan más consultas",async()=>{
 let calls=0;
 const items=Array.from({length:200},(_,i)=>({referencia:String(i)}));
 await assert.rejects(()=>fetchLaboratoryMetricsAdaptive(items,async()=>{
  calls++;
  return {metricsUnavailable:true,metricsErrorCode:"42703",warning:"Columna desconocida"};
 }),/Columna desconocida/);
 assert.equal(calls,1);
});

test("métricas: cancelar al dividir evita consultas posteriores",async()=>{
 const controller=new AbortController();
 let calls=0;
 await assert.rejects(()=>fetchLaboratoryMetricsAdaptive(
  Array.from({length:200},(_,i)=>({referencia:String(i)})),async()=>{
   calls++;
   controller.abort();
   return {metricsUnavailable:true,metricsErrorCode:"57014"};
  },{signal:controller.signal}),{name:"AbortError"});
 assert.equal(calls,1);
});
