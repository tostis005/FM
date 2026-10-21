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
test("API valida permisos y pagina consultas CN SQL con totales del grupo",async()=>{
 const routes={},calls=[];
 const app={get(path,...handlers){routes[path]=handlers.at(-1)}};
 const pool={async query(q){
  calls.push(q);
  assert.match(q.text,/WITH\s+ventas AS MATERIALIZED/);
  assert.match(q.text,/farmetrica.nomenclator_presentaciones/);
  assert.match(q.text,/coalesce|nullif/i);
  assert.ok(!q.text.includes("__SCHEMA__"));
  const page=Math.floor(q.values[6]/q.values[5])+1;
  const group={key:"CN:123456",cn:"123456",kind:"articulo",
   articleName:page===1?"Crema":"Gel",unitsPeriod:18,units3:90,units12:250,
   stock:4,suggested:3,
   pharmacies:[{pharmacyId:"1",articleId:"123456",groupKey:"CN:123456",
    options:[{articleId:"123456",cn:"123456"}],stock:4,suggested:3}]};
  return {rows:[{summary:{products:2,referenceCount:2,unitsPeriod:25,units3:90,
   units12:250,stockKnown:8,stockMissing:0,suggestedKnown:6,
   suggestedMissing:0},groups:[group]}]};
 }};
 setupPurchasePlanner(app,pool,{requireTenant:()=>[]});
 const req={query:{desde:"2026-10-01",hasta:"2026-10-21",farmacias:"1"},
  context:{role:"administrador",modules:{compras:true},client:{schema:"ampedia",slug:"ampedia"},
   pharmacies:[{id:1,name:"Centro"},{id:2,name:"Europa"}]}};
 async function call(query={},context=req.context){
  let code=200,body,error;
  const res={status(v){code=v;return this},json(v){body=v;return this}};
  await routes["/api/analytics/pedidos/propuesta"]({...req,query:{...req.query,...query},context},
   res,e=>{error=e});
  if(error)throw error;
  return {code,body};
 }
 const first=await call({pagina:"1",tamano:"1"});
 assert.equal(first.code,200);
 assert.equal(first.body.groups[0].cn,"123456");
 assert.equal(first.body.summary.unitsPeriod,25);
 assert.equal(first.body.totalGroups,2);
 assert.equal(first.body.groups.length,1);
 const second=await call({pagina:"2",tamano:"1",orden:"unitsPeriod",direccion:"desc"});
 assert.equal(second.code,200);
 assert.equal(second.body.groups[0].articleName,"Gel");
 assert.equal((await call({pagina:"-1"})).code,400);
 assert.equal((await call({farmacias:"3"})).code,400);
 assert.equal((await call({orden:"DROP"})).code,400);
 assert.equal((await call({filtros:'{"noAutorizado":"x"}'})).code,400);
 assert.equal((await call({}, {...req.context,role:"farmacia",modules:{compras:false}})).code,403);
 assert.ok(calls.length>=2);
});

test("genéricos EFG agrupan CN diferentes por DCPF sin sumar dobles previsiones",()=>{
 const base={pharmacyId:"1",unitsPeriod:9,units3:90,units12:365,
  interval:7,lead:2,safety:0,ordered:0,policyDefault:false,confidence:"calculable",stockAt:null};
 const groups=groupPurchaseRows([
  {...base,articleId:"A1",cn:"111111",articleName:"Genérico A",genericDcpf:"7788",genericName:"Principio 20 mg",stock:4,suggested:5},
  {...base,articleId:"B2",cn:"222222",articleName:"Genérico B",genericDcpf:"7788",genericName:"Principio 20 mg",stock:6,suggested:3},
  {...base,articleId:"C3",cn:"333333",articleName:"Marca",stock:2,suggested:7}
 ]);
 assert.equal(groups.length,2);
 const generic=groups.find(g=>g.dcpf==="7788");
 assert.equal(generic.kind,"generico");
 assert.equal(generic.cn,null);
 assert.equal(generic.pharmacies.length,1);
 assert.equal(generic.pharmacies[0].options.length,2);
 assert.equal(generic.pharmacies[0].stock,10);
 assert.equal(generic.pharmacies[0].units3,180);
 assert.equal(generic.pharmacies[0].suggested,8);
 assert.notEqual(generic.pharmacies[0].suggested,5+3+5);
 assert.equal(groups.find(g=>g.cn==="333333").kind,"articulo");
});
