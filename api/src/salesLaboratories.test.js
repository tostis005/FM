import test from "node:test";
import assert from "node:assert/strict";
import {setupSalesLaboratories,laboratoryMovementSQL,laboratoryKeysSQL,mergeLaboratoryMovements,summarizeDirectLaboratory,supplierCodeSQL,plannerReferences,plannerLaboratoryKeysSQL} from "./salesLaboratories.js";
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
 assert.ok(!laboratoryKeysSQL(s,true).includes("a.cn_normalizado"));
 assert.ok(!plannerLaboratoryKeysSQL(s,false).includes("to_jsonb(a)"));
});
test("merge maps exact pharmacy+article, combines months and never assigns an unrelated ERP reference",()=>{
 const keys=[{code:"A",article:"1",cn:"123456",name:"Producto",dcpf:"1",generic:true},{code:"B",article:"9",cn:"123456",name:"Producto",dcpf:"1",generic:true}];
 const rows=[{code:"A",article:"1",units:10,amount:20},{code:"B",article:"9",units:5,amount:10},{code:"A",article:"1",units:-1,amount:-2},{code:"B",article:"1",units:100,amount:100}];
 assert.deepEqual(mergeLaboratoryMovements(keys,rows,false),[{reference:"123456",cn:"123456",name:"Producto",dcpf:"1",generic:true,verifiedGenericUnits:14,units:14,revenue:28}]);
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

test("direct supplier transactions do not establish product identity",async()=>{
 const calls=[],routes=new Map();
 const pool={query:async q=>{
  calls.push(q);
  if(q.text.includes("links AS MATERIALIZED"))return {rows:[{code:"A",article:"PARA-3M",units:755,amount:10751.51},{code:null,article:null,units:0,amount:0}]};
  if(q.text.includes("selected_cn AS MATERIALIZED")){
   assert.equal(q.values.length,3);
   return {rows:[]};
  }
  if(q.text.startsWith("SELECT t.laboratorio_fuente"))return {rows:[]};
  throw Error("unexpected query");
 }};
 setupSalesLaboratories({get:(p,...h)=>routes.set(p,h.at(-1))},pool,{requireTenantModule:()=>[]});
 const res={status(){return this},json(body){this.body=body;return this}};
 await routes.get("/api/analytics/ventas/laboratorios/analisis")({context,query:{...query,laboratorio:"3M"}},res,e=>{throw e});
 assert.equal(res.body.summary.salesUnits,0);
 assert.equal(res.body.summary.purchaseAmount,0);
 assert.equal(res.body.summary.directAmount,10751.51);
 assert.equal(res.body.summary.directUnattributedAmount,10751.51);
 assert.equal(res.body.summary.directUnattributedUnits,755);
 assert.equal(res.body.summary.potentialSaving,null);
 assert.equal(res.body.products.length,0);
 assert.equal(res.body.warnings.length,1);
 assert.equal(calls.filter(q=>q.text.includes("links AS MATERIALIZED")).length,1);
 assert.equal(summarizeDirectLaboratory([]),null);
 assert.equal(summarizeDirectLaboratory([{code:"A",article:null,amount:10,units:1}]).unidentified,10);
});
test("strict identity never uses purchase history, tariff, or numeric ERP id; contradictory ERP labs are excluded",()=>{
 const sql=laboratoryKeysSQL({schema:'"demo_prueba"',canBuy:true,canTariff:true},true);
 assert.ok(!sql.includes("direct_articles"));
 assert.ok(!sql.includes("genericos_ofertas_laboratorios"));
 assert.ok(!sql.includes("fm_recepciones"));
 assert.ok(!sql.includes("origin.cn"));
 assert.ok(sql.includes("count(DISTINCT lab)=1"));
 assert.ok(sql.includes("official_lab<>'' THEN official_lab"));
 assert.ok(sql.includes("cardinality(master_labs)>1 THEN NULL"));
 assert.ok(sql.includes("farmetrica.articulos_laboratorio_maestro"));
 assert.ok(sql.includes("me.codigo=a.ean"));
});
test("direct reconciliation matches exact pharmacy and article, never across pharmacies",()=>{
 const r=summarizeDirectLaboratory([{code:"A",article:"X",units:1,amount:10},{code:"B",article:"X",units:2,amount:20}], [{code:"A",article:"X"}]);
 assert.equal(r.amount,30);assert.equal(r.unattributedAmount,20);assert.equal(r.unattributedUnits,2);assert.equal(r.unattributedReferences,1);
});

test("commercial portfolio requires purchase permission and never compares tariffs",async()=>{
 const calls=[],routes=new Map();
 const pool={query:async q=>{
  calls.push(q);
  if(q.text.includes("links AS MATERIALIZED"))return {rows:[{code:"A",article:"PARA",units:4,amount:20}]};
  if(q.text.includes("direct_articles AS MATERIALIZED"))return {rows:[{code:"A",article:"PARA",cn:null,name:"Cosmética",generic:false,dcpf:null}]};
  if(q.text.includes("AS cache_available"))return {rows:[{id:7,code:"A",today:"2026-11-24",cache_available:false}]};
  if(q.text.includes("v.articulo_id=ANY($2::text[])"))return {rows:[{code:"A",article:"PARA",units:2,amount:12}]};
  if(q.text.includes("selected_cn AS MATERIALIZED"))return {rows:[]};
  throw Error("unexpected query");
 }};
 setupSalesLaboratories({get:(p,...h)=>routes.set(p,h.at(-1))},pool,{requireTenantModule:()=>[]});
 const call=async ctx=>{const res={code:200,status(c){this.code=c;return this},json(body){this.body=body;return this}};await routes.get("/api/analytics/ventas/laboratorios/analisis")({context:ctx,query:{...query,alcance:"proveedor",parte:"ventas"}},res,e=>{throw e});return res};
 const denied=await call({...context,sections:{ventas:true}});assert.equal(denied.code,403);assert.equal(calls.length,0);
 const ok=await call(context);assert.equal(ok.body.summary.salesUnits,2);assert.equal(ok.body.summary.revenue,12);assert.equal(ok.body.tariffAccess,false);assert.equal(ok.body.commercial,true);
 assert.ok(!calls.some(q=>q.text.startsWith("SELECT t.laboratorio_fuente")));
});

test("same preparador references from both categories; local ERP keys remain local",()=>{
 const refs=plannerReferences([{rows:[{referencia:"123456",cn:"123456",nombre:"A"}]},{rows:[{referencia:"123456",cn:"123456",nombre:"A"}, {referencia:"ERP:7:X",nombre:"B"}]}]);
 assert.deepEqual(refs,[{reference:"123456",cn:"123456",name:"A"},{reference:"ERP:7:X",cn:null,name:"B"}]);
 const sql=plannerLaboratoryKeysSQL({schema:'"demo_prueba"'},true);
 assert.ok(sql.includes("a.explicit_cn,a.normalized_cn"));
 assert.ok(sql.includes("coalesce(n.generico,false) AS generic"));
 assert.ok(sql.includes("official_generic_cn AS MATERIALIZED"));
 assert.ok(sql.includes("a.confirmed_cn=n.cn"));
 assert.ok(sql.includes("r.reference='ERP:'||a.id::text||':'||a.article"));
});

test("a numeric ERP fallback must not turn unverified units into generic savings",()=>{
 const keys=[{code:"A",article:"a",cn:"123456",generic:true},{code:"A",article:"123456",cn:"123456",generic:false}];
 const rows=[{code:"A",article:"a",units:4,amount:10},{code:"A",article:"123456",units:5,amount:15}];
 const [result]=mergeLaboratoryMovements(keys,rows,false);
 assert.equal(result.units,9);assert.equal(result.revenue,25);assert.equal(result.generic,true);assert.equal(result.verifiedGenericUnits,4);
});

test("planner report supplements direct receipt references once and preserves purchase totals",async()=>{
 const calls=[],routes=new Map();
 const pool={query:async q=>{
  calls.push(q);
  if(q.text.includes("links AS MATERIALIZED"))return {rows:[{code:"A",article:"GEN",units:5,amount:10},{code:"A",article:"EXTRA",units:4,amount:36.04},{code:"A",article:null,units:0,amount:2}]};
  if(q.text.includes("commercial_cn AS MATERIALIZED")){
   assert.deepEqual(JSON.parse(q.values[3]),[{code:"A",article:"GEN"},{code:"A",article:"EXTRA"}]);
   return {rows:[{code:"A",article:"GEN",cn:"123456",name:"Genérico",dcpf:"A",generic:true},{code:"A",article:"EXTRA",cn:null,name:"Parafarmacia",generic:false}]};
  }
  if(q.text.includes("AS cache_available"))return {rows:[{id:7,code:"A",today:"2026-11-24",cache_available:false}]};
  if(q.text.includes("v.articulo_id=ANY($2::text[])"))return {rows:q.text.includes("fm_recepciones_analitica")?[{code:"A",article:"GEN",units:5,amount:10},{code:"A",article:"EXTRA",units:4,amount:36.04}]:[{code:"A",article:"GEN",units:10,amount:30},{code:"A",article:"EXTRA",units:3,amount:24}]};
  if(q.text.startsWith("SELECT t.laboratorio_fuente"))return {rows:[{laboratory:"TARIFA PROPIA",cn:"123456",generic:true,dcpf:"A",net:2},{laboratory:"OTRO",cn:"456789",generic:true,dcpf:"A",net:1}]};
  throw Error("unexpected query");
 }};
 setupSalesLaboratories({get:(p,...h)=>routes.set(p,h.at(-1))},pool,{requireTenantModule:()=>[],plannerList:async()=>[{key:"P:1",name:"Proveedor"}],plannerCatalogue:async()=>({rows:[{referencia:"123456",cn:"123456",nombre:"Genérico"}]}),nativeCN:async()=>false});
 const res={code:200,status(c){this.code=c;return this},json(body){this.body=body;return this}};
 await routes.get("/api/analytics/ventas/laboratorios/analisis")({context,query:{...query,laboratorio:"P:1"}},res,e=>{throw e});
 assert.equal(res.code,200);assert.deepEqual(res.body.warnings,[]);
 assert.equal(res.body.summary.salesUnits,13);assert.equal(res.body.summary.revenue,54);
 assert.equal(res.body.summary.purchaseAmount,48.04);assert.equal(res.body.summary.directAmount,48.04);
 assert.equal(res.body.summary.potentialSaving,10);
 assert.equal(calls.filter(q=>q.text.includes("links AS MATERIALIZED")).length,1);
});

test("purchase metrics share one response and normalize both supplier-code sides",async()=>{
 const {calls,call}=fixture();
 const r=await call(context,{...query,parte:"compras-completas"});
 assert.equal(r.code,200);
 assert.equal(r.body.purchasesAvailable,true);
 assert.equal(r.body.summary.purchaseAmount,0);
 assert.equal(r.body.summary.directAmount,null);
 assert.equal(r.body.directStatus,"unmapped");
 const sql=calls.find(q=>q.text.includes("links AS MATERIALIZED")).text;
 assert.ok(sql.includes(supplierCodeSQL("a.codigo_origen")));
 assert.ok(sql.includes(supplierCodeSQL("v.proveedor_id")));
 const forbidden=await call({...context,sections:{ventas:true}},{...query,parte:"compras-completas"});
 assert.equal(forbidden.body.purchaseAccess,false);
 assert.equal(forbidden.body.directStatus,"forbidden");
});
