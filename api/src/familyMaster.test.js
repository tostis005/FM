import test from "node:test";
import assert from "node:assert/strict";
import {setupFamilyMaster} from "./familyMaster.js";

function harness(){
 const routes=new Map(),queries=[];
 const app=Object.fromEntries(["get","post","put"].map(method=>[method,(path,...stack)=>
  routes.set(method+" "+path,stack.at(-1))]));
 const pool={async query(sql,values){
  const text=typeof sql==="string"?sql:sql.text;
  const params=typeof sql==="string"?values:sql.values;
  queries.push({text,params});
  if(text.includes("FROM farmetrica.familias_globales g")){
   return {rows:[{id:"5",name:"Dermocosmética",segment:"PARAFARMACIA",
    referencePharmacy:"ALMACEN",referenceCode:"11",customName:false}]};
  }
  if(text.includes("FROM farmetrica.familias_globales_alias a")){
   return {rows:[
    {pharmacyCode:"ALMACEN",sourceCode:"11",sourceName:"DERMOCOSMETICA",method:"referencia"},
    {pharmacyCode:"ABA",sourceCode:"2022",sourceName:"2022 - Dermocosmética",method:"coincidencia_cn"}
   ]};
  }
  throw Error("Consulta inesperada: "+text);
 }};
 setupFamilyMaster(app,pool,{requireTenantManager:()=>[]});
 async function get(path,query={},id){
  const h=routes.get("get "+path);assert.ok(h);
  let status=200,result,error;
  const req={query,params:{id},context:{client:{slug:"ampedia",schema:"ampedia"},pharmacies:[]}};
  const res={status(n){status=n;return this},json(v){result=v;return this}};
  await h(req,res,e=>{error=e});
  if(error)throw error;
  return {status,result};
 }
 return {get,queries};
}
test("el listado inicial consulta únicamente el maestro, sin contar CN",async()=>{
 const {get,queries}=harness();
 const r=await get("/api/tenant/familias-globales");
 assert.equal(r.status,200);
 assert.equal(r.result.summary.maestros,1);
 assert.equal(r.result.summary.parafarmacia,1);
 assert.equal(r.result.groups.length,1);
 assert.equal(r.result.groups[0].name,"Dermocosmética");
 assert.equal(r.result.summary.medicacion,0);
 assert.equal(r.result.items.length,1);
 assert.ok(queries.every(q=>!q.text.includes("familias_globales_articulos")));
 assert.ok(queries.every(q=>!q.text.includes(".articulos")));
 assert.ok(queries.every(q=>!q.text.includes("json_agg")));
});
test("las familias se agrupan antes de paginar y buscar; el listado no ordena por segmento",async()=>{
 const {get,queries}=harness();
 const r=await get("/api/tenant/familias-globales",{view:"pendientes",page:"3",q:"solar"});
 assert.equal(r.result.groups.length,0);
 assert.equal(r.result.summary.pendientes,0);
 assert.equal(queries.length,1);
 assert.deepEqual(queries[0].params,["ampedia"]);
 assert.match(queries[0].text,/ORDER BY g.nombre/);
 assert.doesNotMatch(queries[0].text,/ORDER BY g.segmento/);
 assert.doesNotMatch(queries[0].text,/LIMIT 30/);
});
test("nombres locales de farmacias se consultan sólo al desplegar",async()=>{
 const {get,queries}=harness();
 const r=await get("/api/tenant/familias-globales/:id/origenes",{},"5");
 assert.equal(r.result.items.length,2);
 assert.equal(r.result.items[1].sourceName,"2022 - Dermocosmética");
 assert.ok(queries.every(q=>!q.text.includes("familias_globales_articulos")));
 assert.deepEqual(queries[0].params,["ampedia","5"]);
});
test("rechaza filtros excesivos y IDs inválidos",async()=>{
 const {get,queries}=harness();
 assert.equal((await get("/api/tenant/familias-globales",{q:"X".repeat(101)})).status,400);
 assert.equal((await get("/api/tenant/familias-globales",{view:"otras"})).status,400);
 assert.equal((await get("/api/tenant/familias-globales/:id/origenes",{},"../../x")).status,400);
 assert.equal(queries.length,0);
});
