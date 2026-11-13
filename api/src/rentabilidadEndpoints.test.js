import test from "node:test";
import assert from "node:assert/strict";
import {setupProfitability} from "./rentabilidadAnalisis.js";

function harness(view="overview",fail=null){
 const handlers=new Map(),queries=[];
 const app={get:(route,...middleware)=>handlers.set(route,middleware.at(-1))};
 const pool={query:async(payload)=>{
  queries.push(payload);
  const sql=typeof payload==="string"?payload:payload.text;
  if(sql.includes("information_schema.columns"))
   return {rows:["farmacia_codigo","origen_id","nombre","familia","pmc","pvp","codigo_nacional"]
    .map(column_name=>({column_name}))};
  if(sql.includes("SELECT DISTINCT btrim(nombre)"))
   return {rows:[{name:"Dermocosmética"},{name:"Medicamentos"}]};
  if(fail)throw fail;
  return {rows:view==="overview"?[{kind:"pharmacy",pharmacyId:"1",pharmacyName:"Abadía",
   sales:100,coveredSales:90,margin:25}]:
   view==="products"?[{total:1,name:"Producto prueba",sales:100,margin:25}]:
   [{name:"Producto prueba",sales:100,margin:25}]};
 }};
 setupProfitability(app,pool,{requireTenant:()=>[(_req,_res,next)=>next()]});
 const context={role:"superadministrador",modules:{rentabilidad:true},
  client:{schema:"ampedia",slug:"ampedia"},allowedPharmacyIds:[1]};
 async function call(route="/api/analytics/rentabilidad/:view",query={},ctx=context){
  const handler=handlers.get(route);
  assert.ok(handler,"La ruta debe registrarse: "+route);
  const req={params:{view},query:{desde:"2026-11-01",hasta:"2026-11-13",farmacias:"1",...query},context:ctx};
  let status=200,response;
  const res={status(code){status=code;return this;},json(body){response=body;return this;}};
  await handler(req,res,()=>{throw Error("No se debe delegar un error")});
  return {status,response};
 }
 return {call,queries};
}
test("las tres pestañas tienen respuesta válida y reciben el filtro de familia",async()=>{
 for(const [view,expected] of [["overview",5],["products",8],["sales",8]]){
  const h=harness(view);
  const {status,response}=await h.call(undefined,{familia:"Dermocosmética"});
  assert.equal(status,200,view);
  assert.equal(response.available,true,view);
  assert.equal(response.rows.length,1,view);
  const statement=h.queries.find(q=>typeof q==="object"&&q.text.includes("WITH raw"));
  assert.ok(statement);
  assert.equal(statement.values.length,expected,view);
  assert.equal(statement.values.at(-1),"Dermocosmética",view);
  assert.match(statement.text,/familias_globales/);
 }
});
test("el desplegable devuelve nombres del maestro del cliente, no IDs",async()=>{
 const h=harness();
 const {response,status}=await h.call("/api/analytics/rentabilidad/familias");
 assert.equal(status,200);
 assert.deepEqual(response.families,["Dermocosmética","Medicamentos"]);
 const sql=h.queries.find(x=>typeof x==="object"&&x.text.includes("SELECT DISTINCT btrim(nombre)"));
 assert.deepEqual(sql.values,["ampedia"]);
});
test("las opciones y el análisis respetan el permiso del módulo",async()=>{
 const h=harness();
 const ctx={role:"farmacia",modules:{rentabilidad:false},
  client:{schema:"ampedia",slug:"ampedia"},allowedPharmacyIds:[1]};
 for(const route of ["/api/analytics/rentabilidad/familias","/api/analytics/rentabilidad/:view"]){
  const {status}=await h.call(route,{},ctx);
  assert.equal(status,403);
 }
});
test("caché breve: volver al resumen no recalcula el SQL pesado",async()=>{
 const h=harness();
 await h.call();
 await h.call();
 assert.equal(h.queries.filter(q=>typeof q==="object"&&q.text.includes("WITH raw")).length,1);
 await h.call(undefined,{actualizar:"1"});
 assert.equal(h.queries.filter(q=>typeof q==="object"&&q.text.includes("WITH raw")).length,2);
});
test("un timeout ofrece recuperación explícita y no un fallo genérico",async()=>{
 const previous=console.error;console.error=()=>{};
 try{
  const h=harness("overview",Object.assign(new Error("canceling statement due to statement timeout"),{code:"57014"}));
  const {status,response}=await h.call();
  assert.equal(status,503);
  assert.match(response.error,/período más corto/);
 }finally{console.error=previous;}
});
