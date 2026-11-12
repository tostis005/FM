import test from "node:test";
import assert from "node:assert/strict";
import {setupSalesTotals,buildSalesTotalsSql} from "./salesTotals.js";
function make({hasHistoricalCost=true}={}){
 const routes={};
 const app={get(path,...h){routes[path]=h.at(-1)}};
 const calls=[];
 const pool={async query(sql,params){
  if(sql.includes("information_schema.columns"))
   return {rows:hasHistoricalCost?[{column_name:"coste_historico"}]:[]};
  calls.push({sql,params});
  const max=Math.max(0,...[...sql.matchAll(/\$(\d+)/g)].map(x=>+x[1]));
  assert.equal(max,params.length);
  if(sql.includes("sum(sum(v.importe)) OVER()"))
   return {rows:[{month:"2026-10",ventas:220,unidades:9,
     total_ventas:220,total_unidades:9,total_margen:hasHistoricalCost?30:0,
     total_ventas_con_coste:hasHistoricalCost?200:0,
     total_lineas_con_coste:hasHistoricalCost?9:0,total_lineas_producto:9}]};
  return {rows:[{tipo:"month",month:"2026-10",bucket:null,ventas:220,unidades:9},
   {tipo:"total",month:null,bucket:null,ventas:220,unidades:9}]};
 }};
 setupSalesTotals(app,pool,{requireTenant:()=>[]});
 const ctx={client:{slug:"ampedia",schema:"ampedia"},allowedPharmacyIds:[1,5],
  role:"administrador",modules:{ventas:true},pharmacies:[
   {id:"1",sourceCode:"ABA",databaseCode:"ABA"},
   {id:"5",sourceCode:"POL",databaseCode:"VAL"}]};
 async function call(query={},context=ctx){
  let status=200,data;
  const res={status(n){status=n;return res},json(obj){data=obj;return res}};
  let error;
  await routes["/api/analytics/ventas/totales"]({context,
   query:{desde:"2025-11-01",hasta:"2026-10-18",granularidad:"month",farmacias:"5",...query}},
   res,e=>{error=e});
  if(error)throw error;
  return {status,data};
 }
 return {calls,call};
}
test("12 meses: un SUM mensual y total SQL sin consulta de artículos ni compras",async()=>{
 const {calls,call}=make();
 const {status,data}=await call();
 assert.equal(status,200);
 assert.equal(calls.length,1);
 assert.deepEqual(calls[0].params,["2025-11-01","2026-10-18",["VAL"]]);
 assert.match(calls[0].sql,/v\.farmacia_codigo=ANY\(\$3::text\[\]\)/);
 assert.doesNotMatch(calls[0].sql,/JOIN farmetrica\.farmacias/);
 assert.match(calls[0].sql,/GROUP BY date_trunc\(\x27month\x27,v.fecha\)/);
 assert.match(calls[0].sql,/sum\(sum\(v.importe\)\) OVER\(\)/);
 assert.match(calls[0].sql,/sum\(v.importe\)::float8/);
 assert.doesNotMatch(calls[0].sql,/\.compras|\.articulos|LATERAL|count\(DISTINCT|ROW_NUMBER/i);
 assert.equal(data.kpis.ventas,220);
 assert.equal(data.kpis.unidades,9);
 assert.equal(data.kpis.margen,30,"El margen mensual no debe perder las columnas total_*");
 assert.equal(data.kpis.margenPct,15);
 assert.equal(data.kpis.coberturaCostes,100);
 assert.deepEqual(data.costBasis,{products:9,priced:9,coveredSales:200,margin:30});
 assert.deepEqual(data.series,[{bucket:"2026-10",ventas:220,unidades:9}]);
});
test("el mes con granularidad distinta admite dos niveles de agrupación",()=>{
 for(const type of ["hour","day"]){
  const sql=buildSalesTotalsSql("ampedia",type);
  assert.match(sql,/GROUPING\(periodo\)=0/);
  assert.match(sql,/GROUP BY GROUPING SETS \(\(mes\),\(periodo\),\(\)\)/);
 }
});
test("permisos y filtros se aplican en servidor",async()=>{
 const {call,calls}=make();
 assert.equal((await call({farmacias:"7"})).status,403);
 assert.equal((await call({desde:"invalid",hasta:"2026-10-18"})).status,400);
 assert.equal((await call({familias:"Digestivo"})).status,400);
 assert.equal((await call({buscar:"CN"})).status,400);
 assert.equal((await call({farmacias:"5,4"})).status,403);
 assert.equal(calls.length,0);
 assert.throws(()=>buildSalesTotalsSql("ampedia;DROP","month"));
 assert.equal((await call({}, {client:{slug:"ampedia",schema:"ampedia"},allowedPharmacyIds:[5],
  role:"farmacia",modules:{ventas:false}})).status,403);
});
test("varias farmacias autorizadas usan el mismo sumatorio",async()=>{
 const {calls,call}=make();
 await call({farmacias:"1,5"});
 assert.deepEqual(calls[0].params[2],["ABA","VAL"]);
});

test("sin caché: cada total de ventas se obtiene de PostgreSQL",async()=>{
 const {calls,call}=make();
 const filters={desde:"2021-11-01",hasta:"2026-10-18",farmacias:"5"};
 const [a,b]=await Promise.all([call(filters),call(filters)]);
 assert.equal(a.data.kpis.ventas,220);
 assert.equal(b.data.kpis.ventas,220);
 assert.equal(calls.length,2);
 await call(filters);
 assert.equal(calls.length,3,"consulta real incluso con mismo período");
 await call({...filters,farmacias:"1"});
 assert.equal(calls.length,4);
 await call({...filters,desde:"1900-01-01"});
 assert.equal(calls.length,5);
 assert.equal((await call({...filters,farmacias:"99"})).status,403);
 assert.equal(calls.length,5);
});

test("importe de líneas sin CN/ID se incluye en caja pero nunca infla unidades",()=>{
 for(const granularity of ["hour","day","month"]){
  const sql=buildSalesTotalsSql("ampedia",granularity);
  assert.match(sql,/v\.importe/);
  assert.match(sql,/nullif\(btrim\(v\.articulo_id\),''\) IS NOT NULL/);
  assert.match(sql,/unidades/);
 }
});

test("sin columna coste_historico se siguen mostrando ventas y unidades sin inventar margen",async()=>{
 const {call,calls}=make({hasHistoricalCost:false});
 const {status,data}=await call();
 assert.equal(status,200);
 assert.equal(data.kpis.ventas,220);
 assert.equal(data.kpis.unidades,9);
 assert.equal(data.kpis.margen,null);
 assert.equal(data.kpis.margenPct,null);
 assert.equal(data.kpis.coberturaCostes,0);
 assert.equal(calls.length,1);
 assert.doesNotMatch(calls[0].sql,/v\.coste_historico/);
 assert.match(calls[0].sql,/NULL::numeric/);
 for(const granularity of ["hour","day","month"]){
  assert.doesNotMatch(buildSalesTotalsSql("ampedia",granularity,false),/v\.coste_historico/);
 }
});


test("ventas mensuales reutilizan años y meses cerrados sin volver a sumar líneas",async()=>{
 const routes=new Map(),sql=[];
 const app={get(path,...handlers){routes.set(path,handlers.at(-1))}};
 const pool={query:async(...args)=>{sql.push(args);return {rows:[]}}};
 let cacheCalls=0;
 const consolidations={read:async(args)=>{
  cacheCalls++;
  assert.equal(args.slug,"ampedia");
  assert.deepEqual(args.ids,[1]);
  assert.deepEqual(args.farms,[{id:1,code:"ABA"}]);
  return {available:true,cachedMonths:12,liveRanges:1,sales:{
   from:"2025-11-01",to:"2026-11-12",granularity:"month",
   monthly:[{month:"2025-11",ventas:100,unidades:5},{month:"2026-11",ventas:20,unidades:1}],
   series:[{bucket:"2025-11",ventas:100,unidades:5},{bucket:"2026-11",ventas:20,unidades:1}],
   costBasis:{products:6,priced:6,coveredSales:120,margin:32},
   kpis:{ventas:120,unidades:6,margen:32,margenPct:26.67,coberturaCostes:100}
  }};
 }};
 setupSalesTotals(app,pool,{requireTenant:()=>[],consolidations});
 const ctx={role:"gestor",modules:{ventas:true},
  client:{slug:"ampedia",schema:"ampedia"},allowedPharmacyIds:[1],
  pharmacies:[{id:1,databaseCode:"ABA"}]};
 let response;
 await routes.get("/api/analytics/ventas/totales")({
  context:ctx,query:{desde:"2025-11-01",hasta:"2026-11-12",farmacias:"1",
   granularidad:"month"}},{status(){return this},json(data){response=data;return this}},
  error=>{if(error)throw error});
 assert.equal(cacheCalls,1);
 assert.equal(sql.length,0,"no volver a calcular un año que está consolidado");
 assert.equal(response.kpis.ventas,120);
 assert.equal(response.costBasis.margin,32);
 assert.equal(response.consolidation.cachedMonths,12);
 assert.equal(response.consolidation.immutable,true);
});

test("si falta un cierre mensual, Ventas sigue mostrando las cifras SQL originales",async()=>{
 const routes=new Map(),queries=[];
 const app={get(path,...handlers){routes.set(path,handlers.at(-1))}};
 const pool={query:async(sql,values)=>{
  queries.push(sql);
  if(String(sql).includes("information_schema"))return {rows:[]};
  return {rows:[{month:"2026-10",ventas:55,unidades:5,total_ventas:55,total_unidades:5,
   total_margen:0,total_ventas_con_coste:0,total_lineas_con_coste:0,
   total_lineas_producto:5}]};
 }};
 setupSalesTotals(app,pool,{requireTenant:()=>[],
  consolidations:{read:async()=>({available:false,reason:"pending"})}});
 const ctx={role:"gestor",modules:{ventas:true},
  client:{slug:"ampedia",schema:"ampedia"},allowedPharmacyIds:[1],
  pharmacies:[{id:1,databaseCode:"ABA"}]};
 let response;
 await routes.get("/api/analytics/ventas/totales")({
  context:ctx,query:{desde:"2026-10-01",hasta:"2026-10-31",farmacias:"1",
   granularidad:"month"}},{status(){return this},json(data){response=data;return this}},
  error=>{if(error)throw error});
 assert.equal(response.kpis.ventas,55);
 assert.equal(response.consolidation,undefined);
 assert.ok(queries.some(sql=>String(sql).includes("fm_ventas_analitica")));
});
