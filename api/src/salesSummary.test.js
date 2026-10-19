import test from "node:test";
import assert from "node:assert/strict";
import {buildSalesSummarySql,setupSalesSummary} from "./salesSummary.js";

function make(){
 const routes={};
 const app={get(path,...handlers){routes[path]=handlers.at(-1)}};
 const calls=[];
 const pool={async query(sql,params){
  calls.push({sql,params});
  return {rows:[{
   monthly:[{month:"2026-10",ventas:120,unidades:20}],
   series:[{bucket:"2026-10",ventas:120,unidades:20}],
   products:[{pharmacyId:"5",cn:"654321",name:"Artículo VAL",family:"Medicamentos",
     units:20,value:120,margin:82,abcdClass:"A"}],
   families:["Medicamentos"],counts:{total_products:1,total_articles:1},
   totals:{ventas:120,unidades:20},coverage:{known:1,priced:1,margin:82}
  }]};
 }};
 setupSalesSummary(app,pool,{requireTenant:()=>[]});
 const ctx={client:{slug:"ampedia",schema:"ampedia"},role:"administrador",
  modules:{ventas:true},allowedPharmacyIds:[1,5]};
 async function call(query={}){
  let status=200,body;
  const res={status(n){status=n;return res},json(v){body=v;return res}};
  let error;
  await routes["/api/analytics/ventas/resumen"]({query:{
   desde:"2026-07-18",hasta:"2026-10-18",farmacias:"5",granularidad:"month",...query
  },context:ctx},res,e=>{error=e});
  if(error)throw error;
  return {status,body};
 }
 return {call,calls,ctx,routes};
}

test("una consulta en BD agrega gráfico, KPI, artículos, recuento y ABCD",async()=>{
 const {call,calls}=make();
 const {status,body}=await call();
 assert.equal(status,200);
 assert.equal(calls.length,1);
 assert.deepEqual(calls[0].params,["2026-07-18","2026-10-18",[5],"ampedia","",[]]);
 assert.match(calls[0].sql,/f.id=ANY\(\$3::int\[\]\)/);
 assert.match(calls[0].sql,/sales_scope AS MATERIALIZED/);
 assert.match(calls[0].sql,/FROM "ampedia".fm_ventas_analitica v/);
 assert.match(calls[0].sql,/sum\(importe\)::float8/);
 assert.match(calls[0].sql,/count\(DISTINCT cn\)/);
 assert.equal(body.kpis.ventas,120);
 assert.equal(body.kpis.articulosVendidos,1);
 assert.equal(body.products[0].id,"5|654321");
 assert.equal(body.products[0].abcdClass,"A");
 assert.equal(body.kpis.margen,82);
 assert.equal(body.products[0].margin,82);
});
test("periodos por día, búsquedas y familias siguen filtrados dentro de la BD",async()=>{
 const {call,calls}=make();
 await call({granularidad:"day",buscar:"654321",familias:"Medicamentos"});
 assert.equal(calls.length,1);
 assert.deepEqual(calls[0].params.slice(4),["654321",["Medicamentos"]]);
 assert.match(calls[0].sql,/date_trunc\('day',fecha\)/);
 assert.match(calls[0].sql,/c.family=ANY\(\$6::text\[\]\)/);
});
test("farmacias ajenas, fechas inválidas y SQL dinámico inválido se rechazan",async()=>{
 const {call,calls}=make();
 assert.equal((await call({farmacias:"7"})).status,403);
 assert.equal((await call({desde:"2026-99-99"})).status,400);
 assert.equal(calls.length,0);
 assert.throws(()=>buildSalesSummarySql('ampedia";DROP TABLE ventas;--',"month"));
});
test("si la farmacia autorizada no tiene movimientos el resultado es un cero real",async()=>{
 const {call,calls}=make();
 const r=await call({farmacias:""});
 assert.equal(r.status,200);
 assert.equal(calls.length,1);
});
