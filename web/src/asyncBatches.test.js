import test from "node:test";
import assert from "node:assert/strict";
import {mapLimited} from "./asyncBatches.js";
test("controla peticiones simultáneas y mantiene los resultados en orden",async()=>{
 let active=0,max=0;
 const result=await mapLimited([5,4,3,2,1,0],2,async(n)=>{
  active++;max=Math.max(max,active);
  await new Promise(done=>setTimeout(done,n*2));
  active--;return n*n;
 });
 assert.equal(max,2);
 assert.deepEqual(result,[25,16,9,4,1,0]);
});
test("detiene el lanzamiento de nuevos lotes si se abandona la vista",async()=>{
 let cancelled=false,calls=0;
 const result=await mapLimited([0,1,2,3,4],1,async(n)=>{
  calls++;cancelled=true;return n;
 },{shouldStop:()=>cancelled});
 assert.equal(calls,1);assert.equal(result[0],0);
});
test("propaga el fallo de consulta sin iniciar el resto de los lotes",async()=>{
 let calls=0;
 await assert.rejects(()=>mapLimited([1,2,3,4],1,async()=>{calls++;throw Error("fallo servidor")}),/fallo servidor/);
 assert.equal(calls,1);
});
