import test from "node:test";
import assert from "node:assert/strict";
import {weightedLowPriceReference,validatePolicy,readPricePolicy,setupPricePolicy} from "./pricePolicy.js";
test("percentil 20 = coste ponderado del 20% de unidades con menor precio",()=>{
 assert.equal(weightedLowPriceReference([
  {price:1,units:2},{price:2,units:8},{price:3,units:10}],20),1.5);
 assert.equal(weightedLowPriceReference([{price:2,units:100}],10),2);
 assert.equal(weightedLowPriceReference([{price:0,units:3},{price:2,units:0}],20),null);
});
test("únicamente ventanas y percentiles permitidos",()=>{
 assert.deepEqual(validatePolicy({percentile:25,months:12}),{percentile:25,months:12});
 assert.equal(validatePolicy({percentile:80,months:12}),null);
 assert.equal(validatePolicy({percentile:25,months:24}),null);
});
test("configuración global y excepciones por farmacia",async()=>{
 const pool={query:async(_sql,_args)=>({rows:[
  {farmacia_id:0,percentil:20,meses:6},
  {farmacia_id:3,percentil:10,meses:3}
 ]})};
 const data=await readPricePolicy(pool,"ampedia");
 assert.equal(data.global.percentile,20);
 assert.deepEqual(data.overrides,[{pharmacyId:3,percentile:10,months:3}]);
});
test("no permite que administrador configure otra farmacia",async()=>{
 const app={get(){},put(path,...handlers){this.handler=handlers.at(-1)},delete(){}};
 const pool={query:()=>{throw Error("No debe ejecutar SQL")}};
 setupPricePolicy(app,pool,{requireTenantModule:()=>[],requireTenantAdmin:()=>[]});
 const req={body:{pharmacyId:5,percentile:20,months:6},
  context:{client:{slug:"ampedia"},allowedPharmacyIds:[1]}};
 let code=200;
 const res={status(n){code=n;return this},json(b){this.body=b;return this}};
 await app.handler(req,res,()=>{});
 assert.equal(code,403);
});
