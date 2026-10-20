import test from "node:test";
import assert from "node:assert/strict";
import {setupHistoryCoverage} from "./historyCoverage.js";

function fixture({legacy=false,empty=false}={}){
 const paths={},calls=[];
 const app={get(path,...handlers){paths[path]=handlers.at(-1)}};
 const pool={async query(query,params){
  calls.push({query,params});
  if(typeof query==="string"){
   if(query.includes("information_schema.columns"))
    return {rows:(legacy?["fecha","farmacia_id"]:
      ["fecha","farmacia_codigo"]).map(column_name=>({column_name}))};
   throw Error("Consulta no permitida en la prueba");
  }
  assert.equal(query.query_timeout,8000);
  return {rows:empty?[]:[{first:"2026-02-14"}]};
 }};
 setupHistoryCoverage(app,pool,{requireTenant:()=>[]});
 const context={role:"administrador",client:{schema:"ampedia"},
  modules:{dashboard:true,ventas:true,compras:true},
  allowedPharmacyIds:[1,5],pharmacies:[
   {id:"1",sourceCode:"ABA",databaseCode:"ABA"},
   {id:"5",sourceCode:"POL",databaseCode:"VAL"}]};
 const run=async(query,ctx=context)=>{
  let status=200,data,error;
  const res={status(value){status=value;return this},json(value){data=value;return this}};
  await paths["/api/analytics/historico/primera-fecha"]({query,context:ctx},res,
   e=>{error=e});
  if(error)throw error;
  return {status,data};
 };
 return {run,calls,context};
}

test("la cobertura de ventas usa códigos ERP autorizados y no otros clientes",async()=>{
 const {run,calls}=fixture();
 const r=await run({fuente:"ventas",farmacias:"5"});
 assert.equal(r.status,200);
 assert.equal(r.data.earliest,"2026-02-14");
 assert.deepEqual(calls.at(-1).query.values,[["VAL"]]);
 assert.match(calls.at(-1).query.text,/"ampedia"\."fm_ventas_analitica"/);
 assert.match(calls.at(-1).query.text,/ORDER BY t\.fecha ASC LIMIT 1/);
});
test("las compras normalizadas usan sus propios datos, no los de ventas",async()=>{
 const {run,calls}=fixture();
 const r=await run({fuente:"compras",farmacias:"1,5"});
 assert.equal(r.status,200);
 assert.deepEqual(calls.at(-1).query.values,[["ABA","VAL"]]);
 assert.match(calls.at(-1).query.text,/fm_recepciones_analitica/);
});
test("compras heredadas se consultan por farmacia_id",async()=>{
 const {run,calls}=fixture({legacy:true});
 assert.equal((await run({fuente:"compras",farmacias:"5"})).status,200);
 assert.deepEqual(calls.at(-1).query.values,[[5]]);
 assert.match(calls.at(-1).query.text,/t\.farmacia_id=ANY/);
});
test("una fuente vacía devuelve earliest null y no una fecha inventada",async()=>{
 const {run}=fixture({empty:true});
 assert.deepEqual((await run({fuente:"ventas",farmacias:"1"})).data,{
  source:"ventas",earliest:null});
});
test("no se pueden consultar farmacias ni módulos ajenos",async()=>{
 const {run,calls,context}=fixture();
 assert.equal((await run({fuente:"ventas",farmacias:"2"})).status,403);
 assert.equal((await run({fuente:"ventas",farmacias:"5); DROP TABLE f"})).status,400);
 assert.equal((await run({fuente:"desconocido",farmacias:"1"})).status,400);
 assert.equal((await run({fuente:"ventas",farmacias:"1"},
  {...context,modules:{ventas:false,dashboard:false}})).status,403);
 assert.equal(calls.length,0);
});
