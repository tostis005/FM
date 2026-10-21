import test from "node:test";
import assert from "node:assert/strict";
import {proposePurchase,groupPurchaseRows,setupPurchasePlanner} from "./purchasePlanner.js";

test("propuesta comprueba stock, demanda y pedidos en curso sin inventar inventario",()=>{
 assert.equal(proposePurchase({stock:8,units3:90,units12:200,interval:7,lead:2,safety:3,ordered:2}).suggested,2);
 assert.equal(proposePurchase({stock:null,units3:100}).suggested,null);
 assert.equal(proposePurchase({stock:40,units3:0,units12:0}).suggested,0);
 assert.equal(proposePurchase({stock:0,units3:0,units12:365,interval:7,lead:2,safety:0}).suggested,9);
});
test("agrupación cruza farmacias solo si consta CN, nunca por ID del ERP",()=>{
 const base={articleName:"Crema",stock:5,suggested:3,unitsPeriod:10,units3:35,units12:100};
 const rows=[
  {...base,pharmacyId:"1",articleId:"77",cn:"123456"},
  {...base,pharmacyId:"2",articleId:"991",cn:"123456"},
  {...base,pharmacyId:"1",articleId:"25",cn:null},
  {...base,pharmacyId:"2",articleId:"25",cn:null}
 ];
 const groups=groupPurchaseRows(rows);
 assert.equal(groups.length,3);
 const shared=groups.find(g=>g.cn==="123456");
 assert.equal(shared.pharmacies.length,2);
 assert.equal(shared.suggested,6);
 assert.equal(shared.stock,10);
});
test("API limita tenant/farmacias y recoge ventas, políticas y planes aprobados",async()=>{
 const routes={},seen=[];
 const app={get(path,...handlers){routes[path]=handlers.at(-1)}};
 const pool={async query(sql,params=[]){
  const text=typeof sql==="string"?sql:sql.text;
  const args=typeof sql==="string"?params:sql.values;
  seen.push({text,args});
  if(text.includes("information_schema.columns"))return {rows:[
   ...["farmacia_codigo","origen_id","nombre","stock_actual","codigo_nacional"]
    .map(column_name=>({table_name:"articulos",column_name})),
   ...["farmacia_codigo","articulo_id","fecha","unidades"]
    .map(column_name=>({table_name:"fm_ventas_analitica",column_name}))
  ]};
  if(text.includes("WITH sold AS MATERIALIZED"))return {rows:[{pharmacyId:"1",articleId:"77",
   articleName:"Crema",cn:"123456",stock:4,stockAt:null,unitsPeriod:18,units3:90,units12:250}]};
  if(text.includes("SELECT DISTINCT ON (f.id,a.origen_id)"))return {rows:[]};
  if(text.includes("op_politicas_reposicion"))return {rows:[{farmacia_id:1,intervalo_pedidos:7,plazo_entrega:2,stock_seguridad:1}]};
  if(text.includes("op_pedidos"))return {rows:[{farmacia_id:1,lineas:[
   {articulo:"77",asignaciones:[{unidades:2,proveedor:"P5"}]}]}]};
  throw Error("Unexpected SQL: "+text.slice(0,100));
 }};
 setupPurchasePlanner(app,pool,{requireTenant:()=>[]});
 const req={query:{desde:"2026-10-01",hasta:"2026-10-21",farmacias:"1",buscar:"Crema"},
  context:{role:"administrador",modules:{compras:true},client:{schema:"ampedia",slug:"ampedia"},
   pharmacies:[{id:"1",name:"Centro"},{id:"2",name:"Europa"}]}};
 async function call(query,context=req.context){
  let code=200,body,error;
  const res={status(v){code=v;return this},json(v){body=v;return this}};
  await routes["/api/analytics/pedidos/propuesta"]({...req,query:{...req.query,...query},context},
   res,e=>{error=e});
  if(error)throw error;
  return {code,body};
 }
 const result=await call({});
 assert.equal(result.code,200);
 assert.equal(result.body.groups.length,1);
 assert.equal(result.body.groups[0].pharmacies[0].suggested,4);
 assert.equal(result.body.groups[0].pharmacies[0].ordered,2);
 assert.match(seen.find(x=>x.text.includes("WITH sold AS MATERIALIZED")).text,/ranked AS/);
 assert.match(seen.find(x=>x.text.includes("WITH sold AS MATERIALIZED")).text,/a2.nombre ILIKE/);
 assert.equal((await call({farmacias:"3"})).code,400);
 assert.equal((await call({}, {...req.context,role:"farmacia",modules:{compras:false}})).code,403);
});
