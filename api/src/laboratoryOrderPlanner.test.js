import test from "node:test";
import assert from "node:assert/strict";
import {cnCategory,isOrderQuantity,validPlannerDate,pharmacyScope,
 normalizeDraftItems,readLaboratoryOrderMatrix,setupLaboratoryOrderPlanner} from "./laboratoryOrderPlanner.js";

test("rango CN por los seis dígitos significativos (incluye variante de siete)",()=>{
 for(const cn of ["000000","399999","0000000","3999999"])
  assert.equal(cnCategory(cn),"parafarmacia",cn);
 for(const cn of ["400000","999999","4000000","9999999"])
  assert.equal(cnCategory(cn),"medicacion",cn);
 assert.equal(cnCategory("ERP:1:77"),null);
 assert.equal(cnCategory("ABC"),null);
});
test("cantidades, fechas y alcance para pedido legal",()=>{
 assert.equal(isOrderQuantity(0),true);
 assert.equal(isOrderQuantity(999999),true);
 for(const qty of [-1,1.2,"7",1000000,null])assert.equal(isOrderQuantity(qty),false);
 assert.equal(validPlannerDate("2026-02-29"),false);
 assert.equal(validPlannerDate("2024-02-29"),true);
 assert.equal(pharmacyScope([5,1,1,3]),"1,3,5");
 const med=normalizeDraftItems([{reference:"400000",cn:"400000",name:"Medicamento",
  unitsByPharmacy:{"1":3,"5":4}}],"medicacion",[1,5]);
 assert.deepEqual(med[0].unitsByPharmacy,{"1":3,"5":4});
 assert.equal(normalizeDraftItems([{reference:"400000",cn:"400000",name:"Med",
  units:10}],"medicacion",[1]),null);
 assert.equal(normalizeDraftItems([{reference:"400000",cn:"400000",name:"Med",
  unitsByPharmacy:{"99":10}}],"medicacion",[1]),null);
 assert.equal(normalizeDraftItems([{reference:"400000",cn:"400000",name:"Med",
  units:10}],"parafarmacia",[1]),null);
});
test("matriz consulta solo referencias paginadas y devuelve propuestas separadas",async()=>{
 const queries=[];
 const pool={async query(query){
  const text=typeof query==="string"?query:query.text;
  queries.push({text,values:query.values});
  if(text.includes("FROM filtered ORDER BY"))
   return {rows:[{referencia:"400001",cn:"400001",nombre:"Med 1",
    tipo:"medicacion",total:1,inMaster:true,inReceipts:false}]};
  assert.match(text,/fm_ventas_analitica/);
  assert.match(text,/stock_actual/);
  assert.match(text,/farmetrica.op_pedidos/);
  assert.ok(!text.includes("__SCHEMA__"));
  return {rows:[
   {reference:"400001",pharmacyId:"1",stock:6,units3:90,units12:365,unitsPeriod:5,ordered:2,suggested:4},
   {reference:"400001",pharmacyId:"2",stock:4,units3:45,units12:200,unitsPeriod:7,ordered:0,suggested:3}
  ]};
 }};
 const context={client:{schema:"ampedia",slug:"ampedia"},pharmacies:[{id:1},{id:2}]};
 const d=await readLaboratoryOrderMatrix(pool,context,
  {key:"C:LAB",pharmacies:[1,2],type:"medicacion",
   from:"2026-09-01",to:"2026-10-24",page:1,size:40});
 assert.equal(queries.length,2);
 assert.equal(d.rows.length,1);
 assert.equal(d.rows[0].totalSold,12);
 assert.equal(d.rows[0].totalSuggested,7);
 assert.equal(d.rows[0].byPharmacy["1"].suggested,4);
 assert.deepEqual(queries[1].values.slice(1),[[1,2],"ampedia","2026-09-01","2026-10-24"]);
});
test("API matriz y guardado solo dentro del tenant",async()=>{
 const routes={};
 const app={get(name,...args){routes["GET "+name]=args.at(-1)},
  put(name,...args){routes["PUT "+name]=args.at(-1)}};
 const pool={async query(q){
  return {rows:[{updatedAt:"2026-10-24T06:00Z"}]};
 }};
 setupLaboratoryOrderPlanner(app,pool,{requireTenant:()=>[]});
 const context={client:{slug:"ampedia",schema:"ampedia"},role:"administrador",
  modules:{compras:true},pharmacies:[{id:1},{id:2}]};
 async function call(method,path,data){
  let status=200,body,error;
  const res={status(code){status=code;return this},json(payload){body=payload;return this}};
  await routes[method+" "+path]({
   context,method,query:method==="GET"?data:{},
   body:method==="PUT"?data:{}
  },res,e=>{error=e});
  if(error)throw error;
  return {status,body};
 }
 const path="/api/analytics/pedidos/borrador-laboratorio";
 const base={laboratorio:"C:LAB",farmacias:[1],tipo:"parafarmacia",
  desde:"2026-10-01",hasta:"2026-10-24",lineas:[
   {reference:"000001",cn:"000001",name:"Crema",units:7}]};
 assert.equal((await call("PUT",path,base)).status,200);
 assert.equal((await call("PUT",path,{...base,farmacias:[9]})).status,400);
 assert.equal((await call("PUT",path,{...base,lineas:[{...base.lineas[0],units:2.5}]})).status,400);
 assert.equal((await call("PUT",path,{...base,tipo:"medicacion"})).status,400);
 assert.equal((await call("GET",path,{laboratorio:"C:LAB",farmacias:"99",tipo:"medicacion"})).status,400);
 assert.equal((await call("GET","/api/analytics/pedidos/matriz-laboratorio",
  {laboratorio:"C:LAB",farmacias:"1",tipo:"medicacion",desde:"2026-10-26",hasta:"2026-10-24"})).status,400);
});

test("mantiene los CN aunque la consulta de ventas y existencias falle",async()=>{
 let count=0;
 const pool={async query(q){
  count++;
  if(count===1)return {rows:[{referencia:"790321",cn:"790321",
   nombre:"Medicamento Cinfa",tipo:"medicacion",total:1,inMaster:true}]};
  const error=Error("Consulta de métricas agotada");error.code="57014";throw error;
 }};
 const ctx={client:{schema:"ampedia",slug:"ampedia"},pharmacies:[{id:1}]};
 const original=console.error;console.error=()=>{};
 try{
  const data=await readLaboratoryOrderMatrix(pool,ctx,{
   key:"N:CINFA",pharmacies:[1],type:"medicacion",
   from:"2026-10-01",to:"2026-10-24",page:1,size:40});
  assert.equal(data.total,1);
  assert.equal(data.rows[0].cn,"790321");
  assert.equal(data.rows[0].nombre,"Medicamento Cinfa");
  assert.equal(data.metricsUnavailable,true);
  assert.equal(data.rows[0].byPharmacy["1"].stock,null);
  assert.equal(data.rows[0].byPharmacy["1"].units3,null);
  assert.equal(data.rows[0].totalSuggested,null);
 }finally{console.error=original}
});
