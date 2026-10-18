import test from "node:test";
import assert from "node:assert/strict";
import {buildSalesDetailSQL,setupSalesDetail} from "./salesDetail.js";
function make(){
 const routes={},calls=[];
 const app={get(path,...handlers){routes[path]=handlers.at(-1)}};
 const pool={async query(sql,params){
  calls.push({sql,params});
  return {rows:[{pharmacyId:"5",cn:"654321",name:"Producto",family:"12",units:3,value:45,abcdClass:"A",margin:30}]};
 }};
 setupSalesDetail(app,pool,{requireTenant:()=>[]});
 const ctx={client:{slug:"ampedia",schema:"ampedia"},role:"administrador",
  modules:{ventas:true},allowedPharmacyIds:[1,5],
  pharmacies:[{id:"1",sourceCode:"ABA"},{id:"5",sourceCode:"POL",databaseCode:"VAL"}]};
 async function request(query={}){
  const req={context:ctx,query:{desde:"2025-11-01",hasta:"2026-10-18",farmacias:"5",...query}};
  const res={status(code){res.code=code;return res},json(data){res.data=data;return res}};
  let err;
  await routes["/api/analytics/ventas/detalle"](req,res,e=>{err=e});
  if(err)throw err;
  return {status:res.code||200,data:res.data};
 }
 return {request,calls};
}
test("detalle pagina en PostgreSQL y solo cruza compras para referencias de la página",async()=>{
 const {request,calls}=make();const {data,status}=await request();
 assert.equal(status,200);
 assert.equal(data.products.length,1);
 assert.equal(data.products[0].abcdClass,"A");
 assert.equal(data.products[0].margin,30);
 assert.equal(data.products[0].id,"5|654321");
 assert.equal(calls.length,1);
 assert.deepEqual(calls[0].params,["2025-11-01","2026-10-18",["VAL"],["5"],"",[],201,0]);
 assert.match(calls[0].sql,/page AS MATERIALIZED/);
 assert.match(calls[0].sql,/FROM page p LEFT JOIN costs/);
 assert.doesNotMatch(calls[0].sql,/date_trunc\('month'|GROUPING SETS|jsonb_agg/);
});
test("familias, paginación y farmacias no autorizadas",async()=>{
 const {request,calls}=make();
 await request({pagina:"2",familias:"12",buscar:"654321"});
 assert.deepEqual(calls[0].params.slice(4),["654321",["12"],201,200]);
 assert.equal((await request({farmacias:"9"})).status,403);
 assert.equal((await request({farmacias:"1,5",familias:"12"})).status,400);
 assert.equal((await request({pagina:"0"})).status,400);
 assert.equal((await request({desde:"2020-01-01"})).status,400);
 assert.throws(()=>buildSalesDetailSQL("ampedia;DROP"));
});
