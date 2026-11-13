import test from "node:test";
import assert from "node:assert/strict";
import {setupProfitability} from "./rentabilidadAnalisis.js";

function exercise(view,fail=null){
 let handler,queries=[];
 const app={get:(route,...middleware)=>{
  assert.equal(route,"/api/analytics/rentabilidad/:view");
  handler=middleware.at(-1);
 }};
 const pool={query:async(payload)=>{
  queries.push(payload);
  if((typeof payload==="string"?payload:payload.text)?.includes("information_schema.columns"))
   return {rows:["farmacia_codigo","origen_id","nombre","familia","pmc","pvp","codigo_nacional"]
    .map(column_name=>({column_name}))};
  if(fail)throw fail;
  return {rows:view==="overview"?[{kind:"pharmacy",pharmacyId:"1",pharmacyName:"Abadía",sales:100,coveredSales:90,margin:25}]:
   view==="products"?[{total:1,name:"Producto prueba",sales:100,margin:25}]:
   [{name:"Producto prueba",sales:100,margin:25}]};
 }};
 setupProfitability(app,pool,{requireTenant:()=>[(_req,_res,next)=>next()]});
 const req={params:{view},query:{desde:"2026-11-01",hasta:"2026-11-13",farmacias:"1"},
  context:{role:"superadministrador",modules:{rentabilidad:true},client:{schema:"ampedia",slug:"ampedia"},allowedPharmacyIds:[1]}};
 let status=200,response;
 const res={status(code){status=code;return this;},json(json){response=json;return this;}};
 return handler(req,res,()=>{}).then(()=>({status,response,queries}));
}
test("las tres pestañas tienen respuesta estructurada y parámetros SQL válidos",async()=>{
 for(const [view,expected] of [["overview",4],["products",7],["sales",7]]){
  const r=await exercise(view);
  assert.equal(r.status,200,view);
  assert.equal(r.response.available,true,view);
  assert.equal(r.response.rows.length,1,view);
  assert.equal(r.queries.at(-1).values.length,expected,view);
  assert.match(r.queries.at(-1).text,/familias_globales/);
 }
});
test("un timeout ofrece recuperación explícita y no un fallo genérico",async()=>{
 const original=console.error; console.error=()=>{};
 try{
  const r=await exercise("overview",Object.assign(new Error("canceling statement due to statement timeout"),{code:"57014"}));
  assert.equal(r.status,503);
  assert.match(r.response.error,/período más corto/);
 }finally{console.error=original;}
});
