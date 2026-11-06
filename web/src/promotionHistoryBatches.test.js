import test from "node:test";
import assert from "node:assert/strict";
import {PROMOTION_CN_BATCH_SIZE,requestPromotionBatches,loadPromotionHistoryInBatches}
 from "./promotionHistoryBatches.js";

test("500 CN se consultan en cinco lotes de 100 con máximo dos simultáneos",async()=>{
 const cns=Array.from({length:500},(_,i)=>String(i).padStart(6,"0"));
 let active=0,maxActive=0;
 const requests=[];
 const result=await requestPromotionBatches(cns,async(batch,index)=>{
  active++;maxActive=Math.max(maxActive,active);
  requests.push({size:batch.length,index});
  await Promise.resolve();
  active--;
  return index;
 });
 assert.equal(PROMOTION_CN_BATCH_SIZE,100);
 assert.equal(requests.length,5);
 assert.ok(requests.every(x=>x.size===100));
 assert.ok(maxActive<=2);
 assert.deepEqual(result,[0,1,2,3,4]);
});

test("agrega cantidades, importes y stock de los lotes sin perder farmacias",async()=>{
 const cns=Array.from({length:500},(_,i)=>String(i).padStart(6,"0"));
 let calls=0;
 const out=await loadPromotionHistoryInBatches(cns,async batch=>{
  calls++;
  assert.ok(batch.length<=100);
  return {
   periods:{previous:{"1":7,"2":0},year:{"1":2}},
   amounts:{previous:{"1":53.8},year:{"1":12}},
   stock:{"1":4,"2":0},
   stockUpdatedAt:"2026-11-06T08:00:00Z",
   stockUnavailable:false
  };
 });
 assert.equal(calls,5);
 assert.deepEqual(out.periods,{previous:{"1":35,"2":0},year:{"1":10}});
 assert.deepEqual(out.amounts,{previous:{"1":269},year:{"1":60}});
 assert.deepEqual(out.stock,{"1":20,"2":0});
 assert.equal(out.stockUnavailable,false);
});

test("stock no completo en un lote no se muestra como total real",async()=>{
 const out=await loadPromotionHistoryInBatches(
  Array.from({length:150},(_,i)=>String(i).padStart(6,"0")),
  async (_batch,index)=>({
   periods:{previous:{"1":index+1}},amounts:{},
   stock:{"1":index?5:7,"2":3},
   stockMissingPharmacyIds:index?["1"]:[],
   stockUnavailable:false
  })
 );
 assert.deepEqual(out.periods,{previous:{"1":3}});
 assert.deepEqual(out.stock,{"2":6});
});

test("si una petición falla, no presenta un histórico parcial",async()=>{
 await assert.rejects(()=>loadPromotionHistoryInBatches(
  Array.from({length:240},(_,i)=>String(i).padStart(6,"0")),
  async (_batch,index)=>{
   if(index===1)throw Error("Tiempo agotado");
   return {periods:{previous:{"1":1}},stock:{}};
  }
 ),/Tiempo agotado/);
});

test("800 CN generan ocho lotes exactos y resultados completos",async()=>{
 const cns=Array.from({length:800},(_,i)=>String(i).padStart(6,"0"));
 const sizes=[];
 const result=await loadPromotionHistoryInBatches(cns,async batch=>{
  sizes.push(batch.length);
  return {periods:{previous:{"1":batch.length}},amounts:{previous:{"1":batch.length*1.5}},
   stock:{"1":batch.length},stockUnavailable:false};
 });
 assert.equal(sizes.length,8);
 assert.ok(sizes.every(n=>n===100));
 assert.deepEqual(result.periods,{previous:{"1":800}});
 assert.deepEqual(result.amounts,{previous:{"1":1200}});
 assert.deepEqual(result.stock,{"1":800});
});
