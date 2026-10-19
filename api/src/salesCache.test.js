import test from "node:test";
import assert from "node:assert/strict";
import {analysisWindow,createSalesCache} from "./salesCache.js";

const frozen=()=>new Date("2026-10-19T09:00:00Z");
test("ABCD usa período exacto de 12 meses y cambia al pasar al mes siguiente",()=>{
 assert.deepEqual(analysisWindow(12,frozen()),{from:"2025-11-01",to:"2026-10-19"});
 assert.deepEqual(analysisWindow(3,frozen()),{from:"2026-08-01",to:"2026-10-19"});
 assert.throws(()=>analysisWindow(13,frozen()));
});
test("la consulta cacheada conserva filtro, orden global, aislamiento y página 400",async()=>{
 const calls=[];
 const pool={async query(sql,args){
  calls.push({sql,args});
  if(sql.includes("ventas_analitica_estado"))return {rows:[
   {farmacia_id:1,calculado_en:"2026-10-19T08:00:00Z",hasta:"2026-10-19"},
   {farmacia_id:2,calculado_en:"2026-10-19T08:00:00Z",hasta:"2026-10-19"}]};
  if(sql.includes("ventas_analitica_cache"))return {rows:[{detalle:{cn:"654321",value:100}},{detalle:{cn:"654322",value:80}}]};
  throw Error("Consulta inesperada");
 }};
 const cache=createSalesCache(pool,{now:frozen,autoRun:false,logger:{}});
 const args={slug:"ampedia",ids:[1,2],months:12,from:"2025-11-01",to:"2026-10-19",
  search:"6543",families:["Digestivo"],sortKey:"value",sortDir:"desc",page:2,pageSize:400};
 const data=await cache.read(args);
 assert.equal(data.cache,true);assert.equal(data.stale,false);
 assert.equal(data.products.length,2);
 assert.deepEqual(calls[1].args,["ampedia",12,[1,2],"6543",["Digestivo"],401,400]);
 assert.match(calls[1].sql,/ORDER BY \(i\.detalle->>'value'\)::double precision DESC/);
 assert.equal((await cache.read({...args,sortKey:"DROP"})),null);
 assert.equal((await cache.read({...args,to:"2026-10-18"})),null);
});
test("estado ausente provoca consulta en vivo; estado antiguo desencadena refresco",async()=>{
 const base={slug:"ampedia",ids:[1],months:12,from:"2025-11-01",to:"2026-10-19",
  sortKey:"value",sortDir:"desc"};
 const pool={async query(sql){
  if(sql.includes("ventas_analitica_estado"))return {rows:[]};
  throw Error("No debería consultar filas sin estado");
 }};
 assert.equal(await createSalesCache(pool,{now:frozen,autoRun:false,logger:{}}).read(base),null);
 const stalePool={async query(sql){
  if(sql.includes("ventas_analitica_estado"))return {rows:[
   {farmacia_id:1,calculado_en:"2026-10-17T08:00:00Z",hasta:"2026-10-18"}]};
  return {rows:[]};
 }};
 const res=await createSalesCache(stalePool,{now:frozen,autoRun:false,logger:{}}).read(base);
 assert.equal(res.cache,true);assert.equal(res.stale,true);
});
test("refresco de ventas inserta instantánea y fecha de forma transaccional",async()=>{
 const queries=[];
 const conn={async query(sql,args){
  queries.push({sql,args});
  if(sql.includes("pg_try_advisory_xact_lock"))return {rows:[{acquired:true}]};
  if(sql.includes("SELECT desde::text"))return {rows:[]};
  if(sql.includes("information_schema.columns"))return {rows:[
   ...["farmacia_codigo","articulo_id","fecha","unidades","importe"].map(column_name=>({table_name:"ventas",column_name})),
   ...["farmacia_codigo","origen_id","nombre","familia","codigo_nacional","pvp","pmc","sincronizado_en"].map(column_name=>({table_name:"articulos",column_name})),
   ...["farmacia_codigo","articulo_id","fecha","unidades","coste_unitario"].map(column_name=>({table_name:"compras",column_name}))
  ]};
  if(sql.includes("WITH pharmacy_map AS"))return {rows:[{pharmacyId:"1",cn:"123456",name:"Artículo",family:"",
   units:3,value:18,abcdClass:"A",pvp:7,purchaseCost:2,margin:12}]};
  return {rows:[]};
 },release(){}};
 const pool={connect:async()=>conn};
 const result=await createSalesCache(pool,{now:frozen,autoRun:false,logger:{}}).refreshOne({
  slug:"ampedia",schema:"ampedia",pharmacyId:1,code:"ABA",months:12});
 assert.equal(result,true);
 assert.ok(queries.some(x=>x.sql.includes("jsonb_to_recordset")));
 assert.ok(queries.some(x=>x.sql.includes("INSERT INTO farmetrica.ventas_analitica_estado")));
 assert.ok(queries.some(x=>x.sql==="COMMIT"));
 assert.ok(!queries.some(x=>x.sql==="ROLLBACK"));
 const input=queries.find(x=>x.sql.includes("jsonb_to_recordset"));
 assert.equal(JSON.parse(input.args[3])[0].detalle.abcdClass,"A");
});
