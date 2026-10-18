import test from "node:test";
import assert from "node:assert/strict";
import {setupSalesInsights,buildRecentProductCountSQL,buildPharmacyFamiliesSQL} from "./salesInsights.js";
function make(){
 const handlers={},calls=[];
 const app={get(path,...args){handlers[path]=args.at(-1)}};
 const pool={async query(sql,params){calls.push({sql,params});
  if(sql.includes("SELECT DISTINCT btrim(familia)"))return {rows:[{codigo:"12"},{codigo:"64"}]};
  return {rows:[{totalProducts:120,totalArticles:106}]};
 }};
 setupSalesInsights(app,pool,{requireTenant:()=>[]});
 const ctx={role:"administrador",modules:{ventas:true},client:{slug:"ampedia",schema:"ampedia"},
  allowedPharmacyIds:[1,5],pharmacies:[
   {id:"1",sourceCode:"ABA",databaseCode:"ABA"},
   {id:"5",sourceCode:"POL",databaseCode:"VAL"}
  ]};
 async function call(endpoint,query={},context=ctx){
  const req={context,query},res={status(code){res.code=code;return res},json(data){res.data=data;return res}};
  let err;
  await handlers["/api/analytics/ventas/"+endpoint](req,res,e=>{err=e});
  if(err)throw err;
  return {status:res.code||200,data:res.data};
 }
 return {call,calls,ctx};
}
test("recuento 12 meses usa DISTINCT, índices y código ERP VAL autorizado",async()=>{
 const {call,calls}=make();
 const {data,status}=await call("recuento",{desde:"2025-11-01",hasta:"2026-10-18",farmacias:"5"});
 assert.equal(status,200);
 assert.equal(data.totalProducts,120);
 assert.equal(data.totalArticles,106);
 assert.equal(calls.length,1);
 assert.deepEqual(calls[0].params,[["VAL"],"2025-11-01","2026-10-18"]);
 assert.match(calls[0].sql,/GROUP BY 1,2/);
 assert.match(calls[0].sql,/fm_placeholder_does_not_exist|upper\(btrim\(v.farmacia_codigo\)\)=ANY/);
 assert.doesNotMatch(calls[0].sql,/\.compras|sum\(importe\)/);
});
test("familias se limitan a una sola farmacia y sus identificadores ERP",async()=>{
 const {call,calls}=make();
 const a=await call("familias",{farmacias:"5"});
 assert.equal(a.status,200);
 assert.deepEqual(a.data.families,[{code:"12",label:"Familia 12",pharmacyId:"5"},{code:"64",label:"Familia 64",pharmacyId:"5"}]);
 assert.deepEqual(calls[0].params,["VAL"]);
 const shared=await call("familias",{farmacias:"1,5"});
 assert.equal(shared.data.families.length,0);
 assert.equal(calls.length,1);
});
test("no permite farmacias ajenas ni recuentos del histórico completo",async()=>{
 const {call,calls,ctx}=make();
 assert.equal((await call("recuento",{farmacias:"9",desde:"2025-11-01",hasta:"2026-10-18"})).status,403);
 assert.equal((await call("recuento",{farmacias:"5",desde:"2020-01-01",hasta:"2026-10-18"})).status,400);
 assert.equal((await call("familias",{farmacias:"9"})).status,403);
 assert.equal(calls.length,0);
 assert.throws(()=>buildRecentProductCountSQL('ampedia";DROP TABLE t;--'));
 assert.throws(()=>buildPharmacyFamiliesSQL("bad--"));
 const noModule={...ctx,role:"farmacia",modules:{ventas:false,dashboard:false}};
 assert.equal((await call("familias",{farmacias:"5"},noModule)).status,403);
});
