import test from "node:test";
import assert from "node:assert/strict";
import {setupPurchaseTotals} from "./purchaseTotals.js";

function make({legacy=false,empty=false,headerOnly=false,partiallyPriced=false,
 from="2026-10-01",to="2026-10-18"}={}){
 const endpoints=new Map(),calls=[];
 const app={get:(path,...handlers)=>endpoints.set(path,handlers.at(-1))};
 const fields=legacy?["farmacia_id","fecha","producto_id","proveedor_id","unidades","total","puc"]:
  ["farmacia_codigo","fecha","articulo_id","proveedor_id","unidades","importe","coste_unitario"];
 const pool={async query(sql,params){
  calls.push({sql,params});
  if(sql.includes("information_schema.columns"))return {rows:fields.map(column_name=>({column_name}))};
  assert.deepEqual(params,[from,to,[1],"ampedia"]);
  if(empty)return {rows:[]};
  if(partiallyPriced)return {rows:[{month:"2026-10",pharmacy:"1",supplier:"PR1",
    amount:60,amountRows:2,units:12,unitRows:3,sourceRows:3,receipts:1,lines:3}]};
  if(headerOnly)return {rows:[{month:"2026-10",pharmacy:"1",supplier:"PR1",
    amount:null,amountRows:0,units:null,unitRows:0,sourceRows:30,receipts:30,lines:0}]};
  return {rows:[{month:"2026-10",pharmacy:"1",supplier:"2",amount:60,amountRows:1,sourceRows:1,unitRows:1,units:15,receipts:2,lines:3},
   {month:"2026-10",pharmacy:"1",supplier:"3",amount:40,amountRows:1,sourceRows:1,unitRows:1,units:10,receipts:1,lines:2},
   {month:"2026-10",pharmacy:"1",supplier:"2",amount:20,amountRows:1,sourceRows:1,unitRows:1,units:5,receipts:1,lines:1}]};
 }};
 setupPurchaseTotals(app,pool,{requireTenant:()=>[]});
 const context={allowedPharmacyIds:[1],client:{schema:"ampedia",slug:"ampedia"},
  pharmacies:[{id:1,databaseCode:"ABA",name:"Farmacia"}],role:"superadministrador",modules:{}};
 async function call(query={},path="/api/analytics/compras/resumen"){const req={path,query:{desde:from,hasta:to,farmacias:"1",...query},context};
  let payload,code=200,err;const res={status(n){code=n;return this},json(d){payload=d;return this}};
  await endpoints.get(path)(req,res,e=>{err=e});if(err)throw err;
  return {code,payload};
 }
 return {call,calls,context};
}
test("totales de Compras de todos los proveedores y series, sin leer ventas ni catálogo",async()=>{
 const {call,calls}=make();
 const {code,payload}=await call();
 assert.equal(code,200);
 assert.deepEqual(payload.kpis,{compras:120,unidadesCompradas:30,lineasCompra:6,proveedores:2,recepciones:4});
 assert.equal(payload.monthly.length,1);
 assert.equal(payload.monthly[0].compras,120);
 assert.ok(calls.every(({sql})=>!sql.includes(".fm_ventas_analitica")&&!sql.includes(".articulos")));
 assert.match(calls[1].sql,/GROUP BY 1,f.id,t.proveedor_id/);
 assert.match(calls[1].sql,/cliente_slug=\$4/);
});
test("compras legacy y movimientos no encontrados mantienen 0 real",async()=>{
 const {call,calls}=make({legacy:true,empty:true});
 const {payload}=await call();
 assert.equal(payload.available,true);
 assert.equal(payload.kpis.compras,0);
 assert.match(calls[1].sql,/t\.total/);
 assert.match(calls[1].sql,/f\.id=t\.farmacia_id/);
 assert.doesNotMatch(calls[1].sql,/t\.farmacia_codigo|t\.sistema_origen|t\.documento_id/);
 assert.equal(payload.kpis.recepciones,null);
});
test("denegar ámbitos ajenos y rangos incorrectos",async()=>{
 const {call}=make();
 assert.equal((await call({farmacias:"2"})).code,403);
 assert.equal((await call({desde:"2027-01-01"})).code,400);
 assert.equal((await call({buscar:"test"})).code,400);
});

test("cabeceras de proveedores sin líneas ni importes no se presentan como compras 0",async()=>{
 const {call,calls}=make({headerOnly:true});
 const {code,payload}=await call();
 assert.equal(code,200);
 assert.equal(payload.hasArticleLines,false);
 assert.equal(payload.hasAmounts,false);
 assert.equal(payload.sourceRows,30);
 assert.equal(payload.kpis.recepciones,30);
 assert.equal(payload.kpis.compras,null);
 assert.equal(payload.kpis.unidadesCompradas,null);
 assert.equal(payload.kpis.lineasCompra,null);
 assert.equal(payload.kpis.proveedores,1);
 assert.equal(payload.monthly[0].compras,null);
 assert.match(calls[1].sql,/FILTER\(WHERE nullif\(btrim\(t\.articulo_id::text\),''\) IS NOT NULL\)/);
});

test("Inicio reutiliza recepciones documentales en resumen mensual sin agrupación por proveedor",async()=>{
 const {call,calls}=make();
 const {code,payload}=await call({},"/api/analytics/dashboard/compras");
 assert.equal(code,200);
 assert.equal(payload.kpis.compras,120);
 assert.match(calls[1].sql,/NULL::text AS pharmacy/);
 assert.match(calls[1].sql,/GROUP BY 1 ORDER BY 1/);
 assert.doesNotMatch(calls[1].sql,/GROUP BY 1,f.id,t.proveedor_id/);
 assert.ok(calls.every(({sql})=>!sql.includes(".articulos")&&!sql.includes(".fm_ventas_analitica")));
});

test("un usuario con acceso a Inicio no necesita habilitar Compras para consultar su KPI",async()=>{
 const {call,context}=make();
 context.role="administrador";context.modules={dashboard:true,compras:false};
 assert.equal((await call({},"/api/analytics/dashboard/compras")).code,200);
 assert.equal((await call({},"/api/analytics/compras/resumen")).code,403);
});

test("Inicio admite cinco años completos y la consulta permanece aislada por farmacia",async()=>{
 const {call,calls}=make({from:"2021-11-01",to:"2026-10-20"});
 const {code,payload}=await call({},"/api/analytics/dashboard/compras");
 assert.equal(code,200);
 assert.equal(payload.kpis.unidadesCompradas,30);
 assert.deepEqual(calls.at(-1).params,["2021-11-01","2026-10-20",[1],"ampedia"]);
});

test("las recepciones sin importe no inflan artificialmente el resultado comercial",async()=>{
 const {call}=make({partiallyPriced:true});
 const {code,payload}=await call({},"/api/analytics/dashboard/compras");
 assert.equal(code,200);
 assert.equal(payload.sourceRows,3);
 assert.equal(payload.amountRows,2);
 assert.equal(payload.hasAmounts,false);
 assert.equal(payload.amountCoveragePct,66.67);
 assert.equal(payload.kpis.compras,null,"No sumar solo los costes conocidos");
 assert.equal(payload.monthly[0].compras,null,"No dibujar una cifra parcial");
 assert.equal(payload.kpis.unidadesCompradas,12);
});
