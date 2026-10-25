import test from "node:test";
import assert from "node:assert/strict";
import {readCachedLaboratoryOptions} from "./laboratoryOptionCache.js";

test("el selector comparte consultas simultáneas y reutiliza el resultado con el mismo tenant y farmacias",async()=>{
 const pool={},calls=[];
 const loader=async()=>{calls.push("load");return [{key:"N:CINFA",name:"Cinfa"}]};
 const [a,b]=await Promise.all([
  readCachedLaboratoryOptions(pool,"ampedia",[2,1],loader),
  readCachedLaboratoryOptions(pool,"ampedia",[1,2],loader)
 ]);
 assert.equal(calls.length,1);
 assert.deepEqual(a,b);
 const c=await readCachedLaboratoryOptions(pool,"ampedia",[1,2],loader);
 assert.deepEqual(c,a);
 assert.equal(calls.length,1);
 await readCachedLaboratoryOptions(pool,"ampedia",[1],loader);
 await readCachedLaboratoryOptions(pool,"otro",[1,2],loader);
 await readCachedLaboratoryOptions({}, "ampedia",[1,2],loader);
 assert.equal(calls.length,4,"Nunca mezclar tenant, farmacias ni pool");
});
test("un fallo del selector no se memoriza como catálogo vacío",async()=>{
 const pool={};let times=0;
 await assert.rejects(()=>readCachedLaboratoryOptions(pool,"t",[1],async()=>{
  times++;throw Error("Timeout");
 }),/Timeout/);
 const labs=await readCachedLaboratoryOptions(pool,"t",[1],async()=>{
  times++;return [{key:"N:RECUPERADO"}];
 });
 assert.equal(times,2);
 assert.equal(labs.length,1);
});
