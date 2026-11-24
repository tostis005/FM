import test from "node:test";
import assert from "node:assert/strict";
import {setupSalesLaboratories,laboratoryMovementSQL,laboratoryKeysSQL} from "./salesLaboratories.js";
const context={role:"gestor",client:{slug:"demo_prueba",schema:"demo_prueba"},allowedPharmacyIds:[7],modules:{ventas:true,compras:true,genericos:true},sections:{ventas:true,compras:true,genericos:true}};
const query={laboratorio:"CINFA",farmacias:"7",desde:"2026-10-01",hasta:"2026-11-24"};
function fixture(){
 const routes=new Map(),calls=[];
 const pool={query:async q=>{calls.push(q);if(q.text.includes("information_schema.columns"))return {rows:[{available:true}]};if(q.text.includes("selected_cn AS MATERIALIZED"))return {rows:[{code:"A",article:"1",cn:"123456",name:"Producto",dcpf:"1",generic:true}]};return {rows:[]}}};
 setupSalesLaboratories({get:(p,...h)=>routes.set(p,h.at(-1))},pool,{requireTenantModule:()=>[]});
 async function call(ctx,params=query){
  const res={code:200,status(c){this.code=c;return this},json(body){this.body=body;return this}};
  await routes.get("/api/analytics/ventas/laboratorios/analisis")({context:ctx,query:params},res,e=>{throw e});return res;
 }
 return {calls,call};
}
test("scope isolated; concurrent sales and purchases share one key lookup",async()=>{
 const {calls,call}=fixture();
 assert.equal((await call(context,{...query,farmacias:"8"})).code,400);assert.equal(calls.length,0);
 const [sales,buy]=await Promise.all([call(context,{...query,parte:"ventas"}),call(context,{...query,parte:"compras"})]);
 assert.equal(sales.code,200);assert.equal(buy.code,200);
 assert.equal(calls.filter(q=>q.text.includes("selected_cn AS MATERIALIZED")).length,1);
 assert.equal(calls.filter(q=>q.text.includes("jsonb_to_recordset")).length,2);
 assert.ok(calls.every(q=>!q.text.includes("ampedia.fm_")));
 assert.equal(calls.find(q=>q.text.includes("selected_cn AS MATERIALIZED")).values[0],"demo_prueba");
 assert.deepEqual(calls.find(q=>q.text.includes("selected_cn AS MATERIALIZED")).values[1],[7]);
 assert.equal(sales.body.summary.purchaseAmount,null);
 assert.equal(buy.body.summary.revenue,null);
});
test("sales only never queries purchases or tariffs",async()=>{
 const {calls,call}=fixture();
 const ok=await call({...context,sections:{ventas:true}});
 assert.equal(ok.body.purchaseAccess,false);assert.equal(ok.body.tariffAccess,false);
 assert.ok(calls.every(q=>!q.text.includes("genericos_ofertas_laboratorios")&&!q.text.includes("fm_recepciones_analitica")));
});
test("SQL aggregates indexed movement keys and avoids row-wide JSON conversion",()=>{
 const s={schema:'"demo_prueba"',canTariff:true};
 const sql=laboratoryMovementSQL(s,false);
 assert.ok(sql.includes("v.farmacia_codigo=k.code AND v.articulo_id=k.article"));
 assert.ok(!sql.includes("JOIN LATERAL"));
 assert.ok(sql.includes("ventas_panorama_meses_cerrados"));
 assert.ok(sql.includes("ventas_panorama_mensual"));
 assert.ok(sql.includes("c.mes+interval '1 month' <= $5::date+interval '1 day'"));
 assert.ok(!laboratoryMovementSQL(s,true).includes("ventas_panorama_mensual"));
 assert.ok(laboratoryKeysSQL(s,true).includes("a.cn_normalizado"));
 assert.ok(!laboratoryKeysSQL(s,false).includes("to_jsonb(a)"));
});

test("ranking never waits on tariffs; savings reuses the exact sales result",async()=>{
 const {calls,call}=fixture();
 await call(context,{...query,parte:"ventas"});
 assert.ok(!calls.some(q=>q.text.startsWith("SELECT t.laboratorio_fuente")));
 await call(context,{...query,parte:"ahorro"});
 assert.equal(calls.filter(q=>q.text.includes("jsonb_to_recordset")).length,1);
 assert.equal(calls.filter(q=>q.text.startsWith("SELECT t.laboratorio_fuente")).length,1);
});
