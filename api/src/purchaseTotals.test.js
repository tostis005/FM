import test from "node:test";
import assert from "node:assert/strict";
import {setupPurchaseTotals} from "./purchaseTotals.js";

function make({legacy=false,empty=false,headerOnly=false}={}){
 const endpoints=new Map(),calls=[];
 const app={get:(path,...handlers)=>endpoints.set(path,handlers.at(-1))};
 const fields=legacy?["farmacia_id","fecha","producto_id","proveedor_id","unidades","total","puc"]:
  ["farmacia_codigo","fecha","articulo_id","proveedor_id","unidades","importe","coste_unitario"];
 const pool={async query(sql,params){
  calls.push({sql,params});
  if(sql.includes("information_schema.columns"))return {rows:fields.map(column_name=>({column_name}))};
  assert.deepEqual(params,["2026-10-01","2026-10-18",[1],"ampedia"]);
  if(empty)return {rows:[]};
  if(headerOnly)return {rows:[{month:"2026-10",pharmacy:"1",supplier:"PR1",
    amount:null,amountRows:0,units:null,unitRows:0,sourceRows:30,lines:0}]};
  return {rows:[{month:"2026-10",pharmacy:"1",supplier:"2",amount:60,units:15,lines:3},
   {month:"2026-10",pharmacy:"1",supplier:"3",amount:40,units:10,lines:2},
   {month:"2026-10",pharmacy:"1",supplier:"2",amount:20,units:5,lines:1}]};
 }};
 setupPurchaseTotals(app,pool,{requireTenant:()=>[]});
 const context={allowedPharmacyIds:[1],client:{schema:"ampedia",slug:"ampedia"},
  pharmacies:[{id:1,databaseCode:"ABA",name:"Farmacia"}],role:"superadministrador",modules:{}};
 async function call(query={}){const req={query:{desde:"2026-10-01",hasta:"2026-10-18",farmacias:"1",...query},context};
  let payload,code=200,err;const res={status(n){code=n;return this},json(d){payload=d;return this}};
  await endpoints.get("/api/analytics/compras/resumen")(req,res,e=>{err=e});if(err)throw err;
  return {code,payload};
 }
 return {call,calls};
}
test("totales de Compras de todos los proveedores y series, sin leer ventas ni catálogo",async()=>{
 const {call,calls}=make();
 const {code,payload}=await call();
 assert.equal(code,200);
 assert.deepEqual(payload.kpis,{compras:120,unidadesCompradas:30,lineasCompra:6,proveedores:2});
 assert.equal(payload.monthly.length,1);
 assert.equal(payload.monthly[0].compras,120);
 assert.ok(calls.every(({sql})=>!sql.includes(".ventas")&&!sql.includes(".articulos")));
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
});
test("denegar ámbitos ajenos y rangos incorrectos",async()=>{
 const {call}=make();
 assert.equal((await call({farmacias:"2"})).code,403);
 assert.equal((await call({desde:"2024-01-01"})).code,400);
 assert.equal((await call({buscar:"test"})).code,400);
});

test("cabeceras de proveedores sin líneas ni importes no se presentan como compras 0",async()=>{
 const {call,calls}=make({headerOnly:true});
 const {code,payload}=await call();
 assert.equal(code,200);
 assert.equal(payload.hasArticleLines,false);
 assert.equal(payload.hasAmounts,false);
 assert.equal(payload.sourceRows,30);
 assert.equal(payload.kpis.compras,null);
 assert.equal(payload.kpis.unidadesCompradas,null);
 assert.equal(payload.kpis.lineasCompra,null);
 assert.equal(payload.kpis.proveedores,1);
 assert.equal(payload.monthly[0].compras,null);
 assert.match(calls[1].sql,/FILTER\(WHERE nullif\(btrim\(t\.articulo_id::text\),''\) IS NOT NULL\)/);
});
