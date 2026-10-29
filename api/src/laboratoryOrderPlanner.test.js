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
  if(text.includes("FROM farmetrica.preparador_exclusiones"))return {rows:[]};
  if(text.includes("SELECT intervalo_dias AS days"))return {rows:[{days:3}]};
  if(text.includes("information_schema.columns"))return {rows:[{available:true}]};
  if(text.includes("WITH p AS ("))return {rows:[]};
  if(text.includes("FROM filtered ORDER BY"))
   return {rows:[{referencia:"400001",cn:"400001",nombre:"Med 1",
    tipo:"medicacion",total:1,inMaster:true,inReceipts:false}]};
  assert.match(text,/fm_ventas_lineas/);
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
 // La consulta de columnas del ERP se comparte entre catálogo y matriz.
 assert.equal(queries.length,6);
 assert.equal(queries.filter(q=>q.text.includes("information_schema.columns")).length,1);
 assert.equal(d.rows.length,1);
 assert.equal(d.rows[0].totalSold,12);
 assert.equal(d.rows[0].totalSuggested,7);
 assert.equal(d.rows[0].byPharmacy["1"].suggested,4);
 assert.deepEqual(queries.at(-1).values.slice(1),[[1,2],"ampedia","2026-09-01","2026-10-24"]);
 assert.equal(d.frequencyDays,3);
});
test("matriz directa sobre CN suministrados evita releer catálogo del laboratorio",async()=>{
 const statements=[];
 const pool={async query(q){
  const sql=typeof q==="string"?q:q.text;statements.push(sql);
  if(sql.includes("SELECT intervalo_dias"))return {rows:[{days:7}]};
  if(sql.includes("information_schema.columns"))return {rows:[{available:true}]};
  if(sql.includes("WITH refs AS MATERIALIZED"))return {rows:[
   {reference:"400321",pharmacyId:"1",stock:3,units3:20,units12:50,unitsPeriod:4,
    ordered:0,suggested:5}
  ]};
  throw Error("No se debe consultar el catálogo ni sus recepciones");
 }};
 const ctx={client:{slug:"ampedia",schema:"ampedia"},pharmacies:[{id:1}]};
 const result=await readLaboratoryOrderMatrix(pool,ctx,{
  key:"N:CINFA",pharmacies:[1],type:"medicacion",
  from:"2026-10-01",to:"2026-10-24",
  prefetchedRows:[{referencia:"400321",cn:"400321",nombre:"Medicamento"}]
 });
 assert.equal(result.metricsUnavailable,false);
 assert.equal(result.rows[0].byPharmacy["1"].suggested,5);
 assert.equal(statements.length,3);
 assert.ok(statements.every(q=>!q.includes("preparador_exclusiones")));
});
test("consulta masiva agrupa 250 CN con un único SQL de ventas 3m, 12m y período",async()=>{
 const statements=[];
 const refs=Array.from({length:250},(_,i)=>({referencia:String(400000+i),
  cn:String(400000+i),nombre:"Medicamento "+i}));
 const pool={async query(q){
  const sql=typeof q==="string"?q:q.text;statements.push({sql,values:q.values});
  if(sql.includes("SELECT intervalo_dias"))return {rows:[{days:7}]};
  if(sql.includes("information_schema.columns"))return {rows:[{available:true}]};
  if(sql.includes("WITH refs AS MATERIALIZED"))return {rows:[
   {reference:"400000",pharmacyId:"1",stock:4,unitsPeriod:9,units3:90,
    units12:360,suggested:20,ordered:0}
  ]};
  throw Error("Solo una consulta agregada para todas las referencias");
 }};
 const ctx={client:{slug:"ampedia",schema:"ampedia"},pharmacies:[{id:1}]};
 const res=await readLaboratoryOrderMatrix(pool,ctx,{
  key:"N:CINFA",pharmacies:[1],type:"medicacion",
  from:"2026-10-01",to:"2026-10-24",prefetchedRows:refs
 });
 assert.equal(statements.filter(q=>q.sql.includes("WITH refs AS MATERIALIZED")).length,1);
 assert.equal(JSON.parse(statements.at(-1).values[0]).length,250);
 assert.equal(res.rows.length,250);
 assert.equal(res.rows[0].byPharmacy["1"].units3,90);
 assert.equal(res.rows[0].byPharmacy["1"].units12,360);
 assert.equal(res.rows[0].byPharmacy["1"].unitsPeriod,9);
 assert.equal(res.rows[0].byPharmacy["1"].suggested,20);
 assert.equal(res.rows[249].totalSold,0);
});
test("API matriz y guardado solo dentro del tenant",async()=>{
 const routes={};
 const app={get(name,...args){routes["GET "+name]=args.at(-1)},
  put(name,...args){routes["PUT "+name]=args.at(-1)},
  post(name,...args){routes["POST "+name]=args.at(-1)}};
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
   body:["PUT","POST"].includes(method)?data:{}
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
 assert.equal((await call("GET","/api/analytics/pedidos/catalogo-unificado",
  {laboratorio:"N:CINFA",farmacias:"99",tipo:"medicacion"})).status,400);
 assert.equal((await call("POST","/api/analytics/pedidos/matriz-conjunta",
  {...base,tipo:"medicacion",referencias:[]})).status,400);
 assert.equal((await call("POST","/api/analytics/pedidos/matriz-conjunta",
  {...base,tipo:"medicacion",farmacias:[99],
   referencias:[{referencia:"400123",cn:"400123"}]})).status,400);
 assert.equal((await call("POST","/api/analytics/pedidos/matriz-conjunta",
  {...base,tipo:"medicacion",
   referencias:[{referencia:"ERP:1:ABC",cn:null}]})).status,400);
 assert.equal((await call("POST","/api/analytics/pedidos/matriz-referencias",
  {...base,tipo:"medicacion",referencias:[]})).status,400);
 assert.equal((await call("POST","/api/analytics/pedidos/matriz-referencias",
  {...base,tipo:"medicacion",referencias:[{referencia:"ERP:1:ABC",cn:null}]})).status,400);
 assert.equal((await call("POST","/api/analytics/pedidos/matriz-referencias",
  {...base,tipo:"medicacion",farmacias:[99],referencias:[{referencia:"400321",cn:"400321"}]})).status,400);
 assert.equal((await call("GET","/api/analytics/pedidos/matriz-laboratorio",
  {laboratorio:"C:LAB",farmacias:"1",tipo:"medicacion",desde:"2026-10-26",hasta:"2026-10-24"})).status,400);
});

test("el preparador consulta ventas con identificadores indexados del documento Farmatic",async()=>{
 const {readFile}=await import("node:fs/promises");
 const sql=await readFile(new URL("./laboratoryOrderMetrics.sql",import.meta.url),"utf8");
 assert.match(sql,/l\.articulo_origen_id=a\.article_id/);
 assert.match(sql,/article_matches AS/);
 assert.match(sql,/a\.origen_id::text=x\.cn/);
 assert.match(sql,/__CN_NORMALIZED__/);
 assert.doesNotMatch(sql,/JOIN refs x ON \(x\.cn/);
 assert.match(sql,/JOIN pharmacies scope ON scope\.id=a\.pharmacy_id/);
 assert.match(sql,/l\.farmacia_codigo=scope\.source_code/);
 assert.match(sql,/pending_orders AS MATERIALIZED/);
 assert.doesNotMatch(sql,/FROM articles a\s+JOIN farmetrica\.op_pedidos p/);
 assert.doesNotMatch(sql,/upper\(btrim\(l\.farmacia_codigo\)\)/i);
});

test("ventas fijas de 90/365 días hasta hoy; fechas históricas solo para V. período",async()=>{
 const {readFile}=await import("node:fs/promises");
 const sql=await readFile(new URL("./laboratoryOrderMetrics.sql",import.meta.url),"utf8");
 assert.match(sql,/now\(\) AT TIME ZONE 'Europe\/Madrid'/);
 assert.match(sql,/FILTER \(WHERE h\.fecha >= d\.today-interval '89 days'/);
 assert.match(sql,/FILTER \(WHERE h\.fecha >= d\.today-interval '364 days'/);
 assert.match(sql,/FILTER \(WHERE h\.fecha >= \$4::date AND h\.fecha < \$5::date/);
 assert.match(sql,/OR \(h\.fecha >= d\.today-interval '364 days'/);
 assert.doesNotMatch(sql,/h\.fecha >= \$5::date-interval '89 days'/);
});
