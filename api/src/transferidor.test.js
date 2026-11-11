import test from "node:test";
import assert from "node:assert/strict";
import {buildGlobalTransfers,parseTransferFilters,filterTransferPlan,setupTransferidor} from "./transferidor.js";

const pharmacies=[{id:"1",name:"Abadía"},{id:"2",name:"Europa"},{id:"3",name:"Centro"},{id:"4",name:"Norte"}];
const item=(pharmacyId,cn,stock,target)=>({
 pharmacyId,cn,name:"Parafarmacia",stock,units3:0,units12:target*365/20,ordered:0
});

test("redistribuye globalmente un CN sin asignar dos veces las mismas unidades",()=>{
 const result=buildGlobalTransfers([
  item("1","123456",2,5),item("2","123456",8,2),
  item("3","123456",1,4),item("4","123456",0,0)
 ],pharmacies,20);
 assert.equal(result.transfers.reduce((n,t)=>n+t.units,0),6);
 assert.deepEqual(result.transfers.map(t=>[t.originId,t.destinationId,t.units]),
  [["2","1",3],["2","3",3]]);
 assert.ok(result.transfers.every(t=>t.originId!==t.destinationId));
 assert.equal(result.skipped,0);
});

test("medicación queda fuera y un artículo sin stock fiable nunca se reparte",()=>{
 const result=buildGlobalTransfers([
  item("1","500001",10,0),item("2","500001",0,9),
  item("1","123457",null,2),item("2","123457",10,0),
  item("1","123458",6.5,0),item("2","123458",0,4)
 ],pharmacies.slice(0,2),20);
 assert.deepEqual(result.transfers.map(x=>x.cn),["123458"]);
 assert.equal(result.transfers[0].units,4);
 assert.equal(result.skipped,1);
});

test("filtra todos, envío, recepción y farmacia de origen/destino sobre plan global",()=>{
 const plan=buildGlobalTransfers([
  item("1","123456",1,5),item("2","123456",12,1),item("3","123456",0,5)
 ],pharmacies.slice(0,3),20).transfers;
 const opts=raw=>parseTransferFilters({pagina:1,tamano:10,...raw},pharmacies.slice(0,3));
 assert.equal(filterTransferPlan(plan,opts({vista:"recibo",farmacia:"3"})).total,1);
 assert.equal(filterTransferPlan(plan,opts({vista:"envio",farmacia:"1"})).total,0);
 assert.equal(filterTransferPlan(plan,opts({origen:"2",destino:"1"})).total,1);
 assert.equal(filterTransferPlan(plan,opts({vista:"todos",farmacia:"2"})).total,2);
 assert.throws(()=>opts({origen:"9"}),/filtros|farmacia/);
 assert.throws(()=>opts({filtros:'{"__proto__":"x"}'}),/filtros|farmacia/);
});

test("dos donantes y dos receptores mantienen saldos globales coherentes",()=>{
 const rows=[item("1","123459",6,1),item("2","123459",7,2),
  item("3","123459",0,8),item("4","123459",1,7)];
 const plan=buildGlobalTransfers(rows,pharmacies,20).transfers;
 assert.equal(plan.reduce((n,r)=>n+r.units,0),10);
 for(const [id,available] of [["1",5],["2",5]]){
  assert.ok(plan.filter(r=>r.originId===id).reduce((n,r)=>n+r.units,0)<=available);
 }
 assert.equal(plan.filter(r=>r.destinationId==="3").reduce((n,r)=>n+r.units,0),8);
 assert.equal(plan.filter(r=>r.destinationId==="4").reduce((n,r)=>n+r.units,0),2);
 const page=filterTransferPlan(plan,parseTransferFilters({pagina:"2",tamano:"10",
  orden:"units",direccion:"desc"},pharmacies));
 assert.equal(page.total,plan.length,"El total se cuenta antes de paginar");
});

test("la API mantiene el plan si falta la importación de una tercera farmacia",async()=>{
 const queries=[];
 const db={async query(arg){
  const q=typeof arg==="string"?arg:arg.text;
  queries.push({q,values:typeof arg==="string"?[]:arg.values});
  if(q.includes("AS ready FROM farmetrica.farmacias"))return {rows:[
   {id:"1",ready:true},{id:"2",ready:true},{id:"3",ready:false}
  ]};
  if(q.includes("information_schema.columns"))return {rows:[{available:true}]};
  if(q.includes("WITH chosen AS MATERIALIZED"))return {rows:[
   {pharmacyId:"1",cn:"123456",name:"Crema",stock:20,units3:0,units12:0},
   {pharmacyId:"2",cn:"123456",name:"Crema",stock:0,units3:90,units12:90}
  ]};
  if(q.includes("preparador_configuracion_cliente"))return {rows:[{days:20}]};
  throw Error("Consulta imprevista: "+q.slice(0,100));
 }};
 let handler;
 setupTransferidor({get(path,...stack){
  assert.equal(path,"/api/analytics/stock/transferidor");
  handler=stack.at(-1);
 }},db,{requireTenant:()=>[]});
 const req={context:{role:"superadministrador",client:{slug:"ampedia",schema:"ampedia"},
  pharmacies:pharmacies.slice(0,3)},query:{vista:"todos",pagina:"1",tamano:"50"}};
 const res={statusCode:200,status(n){this.statusCode=n;return this;},
  json(value){this.body=value;return this;}};
 let err=null;
 await handler(req,res,e=>{err=e});
 if(err)throw err;
 assert.equal(res.statusCode,200);
 assert.equal(res.body.available,true);
 assert.equal(res.body.total,1);
 assert.equal(res.body.rows[0].originName,"Abadía");
 assert.equal(res.body.rows[0].destinationName,"Europa");
 assert.equal(res.body.rows[0].units,20);
 assert.match(res.body.warning,/Centro/);
 const selected=queries.find(x=>x.q.includes("WITH chosen AS MATERIALIZED"));
 assert.deepEqual(selected.values[1],[1,2]);
 assert.doesNotMatch(selected.q,/HAVING count\(DISTINCT fid\)>1/);
 assert.match(selected.q,/cn_normalizado/);
});
