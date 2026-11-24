import test from "node:test";
import assert from "node:assert/strict";
import {setupSalesLaboratories} from "./salesLaboratories.js";
const context={role:"gestor",client:{slug:"demo_prueba",schema:"demo_prueba"},allowedPharmacyIds:[7],modules:{ventas:true,compras:true,genericos:true},sections:{ventas:true,compras:true,genericos:true}};
const query={laboratorio:"CINFA",farmacias:"7",desde:"2026-10-01",hasta:"2026-11-24"};
function fixture(){
 const routes=new Map(),calls=[];
 setupSalesLaboratories({get:(p,...h)=>routes.set(p,h.at(-1))},{query:async q=>{calls.push(q);return {rows:[]}}},{requireTenantModule:()=>[]});
 async function call(ctx,params=query){
  const res={code:200,status(c){this.code=c;return this},json(body){this.body=body;return this}};
  await routes.get("/api/analytics/ventas/laboratorios/analisis")({context:ctx,query:params},res,e=>{throw e});return res;
 }
 return {calls,call};
}
test("only authorized pharmacy scope and tenant are sent to SQL",async()=>{
 const {calls,call}=fixture();
 const denied=await call(context,{...query,farmacias:"8"});assert.equal(denied.code,400);assert.equal(calls.length,0);
 const ok=await call(context);assert.equal(ok.code,200);assert.equal(calls.length,4);
 for(const q of calls){assert.equal(q.values[0],"demo_prueba");if(q.values.length>1)assert.deepEqual(q.values[1],[7]);assert.ok(!q.text.includes("ampedia.fm_"));}
});
test("sales alone does not expose purchases or tariff tables",async()=>{
 const {calls,call}=fixture();
 const ok=await call({...context,sections:{ventas:true}});assert.equal(ok.code,200);assert.equal(calls.length,1);
 assert.equal(ok.body.purchaseAccess,false);assert.equal(ok.body.tariffAccess,false);
 assert.equal(ok.body.summary.purchaseAmount,null);assert.equal(ok.body.summary.potentialSaving,null);
 assert.ok(!calls[0].text.includes("genericos_ofertas_laboratorios"));
});
