import test from "node:test";
import assert from "node:assert/strict";
import {setupSalesLaboratories,laboratoryMovementSQL,laboratoryKeysSQL,mergeLaboratoryMovements,summarizeDirectLaboratory} from "./salesLaboratories.js";
const context={role:"gestor",client:{slug:"demo_prueba",schema:"demo_prueba"},allowedPharmacyIds:[7],modules:{ventas:true,compras:true,genericos:true},sections:{ventas:true,compras:true,genericos:true}};
const query={laboratorio:"CINFA",farmacias:"7",desde:"2026-10-01",hasta:"2026-11-24"};
function fixture(){
 const routes=new Map(),calls=[];
 const pool={query:async q=>{calls.push(q);if(q.text.includes("information_schema.columns"))return {rows:[{available:true}]};if(q.text.includes("selected_cn AS MATERIALIZED"))return {rows:[{code:"A",article:"1",cn:"123456",name:"Producto",dcpf:"1",generic:true}]};if(q.text.includes("AS cache_available"))return {rows:[{id:7,code:"A",today:"2026-11-24",cache_available:false}]};return {rows:[]}}};
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
 assert.equal(calls.filter(q=>q.text.includes("v.articulo_id=ANY($2::text[])")).length,2);
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
test("SQL uses explicit indexed filters and avoids dynamic range joins",()=>{
 const s={schema:'"demo_prueba"',canTariff:true};
 const sql=laboratoryMovementSQL(s,false);
 assert.ok(sql.includes("v.farmacia_codigo=$1 AND v.articulo_id=ANY($2::text[])"));
 assert.ok(sql.includes("v.fecha>=$3::date"));
 assert.ok(!sql.includes("jsonb_to_recordset"));
 assert.ok(laboratoryKeysSQL(s,true).includes("a.cn_normalizado"));
 assert.ok(!laboratoryKeysSQL(s,false).includes("to_jsonb(a)"));
});
test("merge maps exact pharmacy+article, combines months and never assigns an unrelated ERP reference",()=>{
 const keys=[{code:"A",article:"1",cn:"123456",name:"Producto",dcpf:"1",generic:true},{code:"B",article:"9",cn:"123456",name:"Producto",dcpf:"1",generic:true}];
 const rows=[{code:"A",article:"1",units:10,amount:20},{code:"B",article:"9",units:5,amount:10},{code:"A",article:"1",units:-1,amount:-2},{code:"B",article:"1",units:100,amount:100}];
 assert.deepEqual(mergeLaboratoryMovements(keys,rows,false),[{reference:"123456",cn:"123456",name:"Producto",dcpf:"1",generic:true,units:14,revenue:28}]);
});

test("ranking never waits on tariffs; savings reuses the exact sales result",async()=>{
 const {calls,call}=fixture();
 await call(context,{...query,parte:"ventas"});
 assert.ok(!calls.some(q=>q.text.startsWith("SELECT t.laboratorio_fuente")));
 await call(context,{...query,parte:"ahorro"});
 assert.equal(calls.filter(q=>q.text.includes("v.articulo_id=ANY($2::text[])")).length,1);
 assert.equal(calls.filter(q=>q.text.startsWith("SELECT t.laboratorio_fuente")).length,1);
});

test("cached complete month and raw partial month sum without double counting",async()=>{
 const calls=[];
 const pool={query:async q=>{
  calls.push(q);
  if(q.text.includes("information_schema.columns"))return {rows:[{available:true}]};
  if(q.text.includes("links AS MATERIALIZED"))return {rows:[]};
  if(q.text.includes("selected_cn AS MATERIALIZED"))return {rows:[{code:"A",article:"1",cn:"123456",name:"Producto",dcpf:"1",generic:true}]};
  if(q.text.includes("AS cache_available"))return {rows:[{id:7,code:"A",today:"2026-11-24",cache_available:true}]};
  if(q.text.startsWith("SELECT farmacia_id,mes::text AS mes FROM"))return {rows:[{farmacia_id:7,mes:"2026-10-01"}]};
  if(q.text.startsWith("SELECT farmacia_id,mes::text AS mes,clave"))return {rows:[{farmacia_id:7,mes:"2026-10-01",article:"1",units:10,amount:20},{farmacia_id:7,mes:"2026-11-01",article:"1",units:999,amount:999}]};
  if(q.text.includes("v.articulo_id=ANY($2::text[])"))return {rows:[{code:"A",article:"1",units:3,amount:6}]};
  throw Error("unexpected query");
 }};
 const routes=new Map();
 setupSalesLaboratories({get:(p,...h)=>routes.set(p,h.at(-1))},pool,{requireTenantModule:()=>[]});
 const res={status(){return this},json(body){this.body=body;return this}};
 await routes.get("/api/analytics/ventas/laboratorios/analisis")({context,query:{...query,parte:"ventas"}},res,e=>{throw e});
 assert.deepEqual(res.body.warnings,[]);
 assert.equal(res.body.summary.salesUnits,13);
 assert.equal(res.body.summary.revenue,26);
 assert.deepEqual(calls.find(q=>q.text.includes("v.articulo_id=ANY($2::text[])")).values,["A",["1"],"2026-11-01","2026-11-24"]);
});

test("product scope includes brand and para products even without AEMPS laboratory; no generic or tariff requirement",()=>{
 const sql=laboratoryKeysSQL({schema:'"demo_prueba"',canTariff:false},true);
 assert.ok(sql.includes("laboratorio_comercializador"));
 assert.ok(sql.includes("laboratorio_titular"));
 assert.ok(sql.includes("a.laboratory"));
 assert.ok(!sql.includes("n.cn IS NULL AND"));
 assert.ok(!sql.includes("generico=true"));
 assert.ok(!sql.includes("genericos_ofertas_laboratorios"));
});

test("direct supplier evidence is shared with product identification and no supplier is inferred from another pharmacy's ERP code",async()=>{
 const calls=[],routes=new Map();
 const pool={query:async q=>{
  calls.push(q);
  if(q.text.includes("information_schema.columns"))return {rows:[{available:true}]};
  if(q.text.includes("links AS MATERIALIZED"))return {rows:[{code:"A",article:"PARA-3M",units:755,amount:10751.51},{code:null,article:null,units:0,amount:0}]};
  if(q.text.includes("selected_cn AS MATERIALIZED")){
   assert.deepEqual(JSON.parse(q.values[3]),[{code:"A",article:"PARA-3M"}]);
   return {rows:[{code:"A",article:"PARA-3M",cn:null,name:"Producto de parafarmacia",generic:null,dcpf:null}]};
  }
  if(q.text.includes("AS cache_available"))return {rows:[{id:7,code:"A",today:"2026-11-24",cache_available:false}]};
  if(q.text.includes("v.articulo_id=ANY($2::text[])"))return {rows:[{code:"A",article:"PARA-3M",units:755,amount:10751.51}]};
  return {rows:[]};
 }};
 setupSalesLaboratories({get:(p,...h)=>routes.set(p,h.at(-1))},pool,{requireTenantModule:()=>[]});
 const res={status(){return this},json(body){this.body=body;return this}};
 await routes.get("/api/analytics/ventas/laboratorios/analisis")({context,query:{...query,laboratorio:"3M"}},res,e=>{throw e});
 assert.deepEqual(res.body.warnings,[]);
 assert.equal(res.body.summary.salesUnits,755);
 assert.equal(res.body.summary.purchaseAmount,10751.51);
 assert.equal(res.body.summary.directAmount,10751.51);
 assert.equal(res.body.summary.potentialSaving,null);
 assert.equal(calls.filter(q=>q.text.includes("links AS MATERIALIZED")).length,1);
 assert.equal(summarizeDirectLaboratory([]),null);
 assert.equal(summarizeDirectLaboratory([{code:"A",article:null,amount:10,units:1}]).unidentified,10);
});
