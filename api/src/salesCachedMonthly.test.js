import test from "node:test";
import assert from "node:assert/strict";
import {createSalesMonthlyReader} from "./salesCachedMonthly.js";

const farms=[{id:1,code:"ABA"},{id:2,code:"EUR"}];
const from="2024-12-01",to="2026-11-12";
const row=(id,mes)=>({farmacia_id:id,mes,fuente:"ventas",importe:100,
 unidades:2,filas:2,filas_importe:2,filas_unidades:2,filas_producto:2,
 documentos:0,filas_coste:2,ventas_con_coste:100,margen_coste:30});
function fixture({missingMonths=[],missingForPharmacy=null}={}){
 const missing=new Set(missingMonths),scans=[],scheduled=[],queries=[];
 const pool={
  async query(sql,params){
   queries.push({sql,params});
   assert.match(sql,/fuente='ventas'/);
   return {rows:params[2].flatMap(month=>farms.flatMap(f=>
    missing.has(month)&&(!missingForPharmacy||missingForPharmacy===f.id)?
     []:[row(f.id,month)]))};
  },
  async connect(){
   return {async query(sql,params){
    if(typeof sql==="string"&&sql.includes("FROM jsonb_to_recordset")){
     assert.match(sql,/fm_ventas_cabeceras/);
     assert.doesNotMatch(sql,/fm_recepciones_cabeceras/);
     scans.push(params);
     return {rows:JSON.parse(params[0]).map(f=>row(f.id,params[3]))};
    }
    return {rows:[]};
   },release(){}};
  }
 };
 const read=createSalesMonthlyReader(pool,{
  dbClock:async()=>({today:"2026-11-12"}),
  scheduleMonth:(scope,month)=>scheduled.push({scope,month})
 });
 return {read,scans,scheduled,queries};
}
const request={slug:"ampedia",schema:"ampedia",ids:[1,2],farms,from,to};

test("24 meses completos: consulta caché de Ventas y solo el mes abierto, sin consultar Compras",async()=>{
 const f=fixture(),result=await f.read(request);
 assert.equal(result.available,true);
 assert.equal(result.cachedMonths,23);
 assert.equal(result.missingLiveMonths,0);
 assert.equal(result.immutable,true);
 assert.equal(f.queries.length,1);
 assert.equal(f.scans.length,1);
 assert.deepEqual(f.scans[0].slice(1,4),["2026-11-01","2026-11-13","2026-11-01"]);
 assert.equal(result.sales.monthly.length,24);
 assert.equal(result.sales.kpis.ventas,4800);
 assert.equal(result.sales.kpis.unidades,96);
 assert.equal(result.sales.kpis.margen,1440);
 assert.equal(result.sales.kpis.margenPct,30);
 assert.equal(result.sales.kpis.coberturaCostes,100);
});
test("solo una farmacia sin un cierre: consulta su mes, no vuelve a sumar 24 meses",async()=>{
 const f=fixture({missingMonths:["2025-05-01"],missingForPharmacy:1});
 const result=await f.read(request);
 assert.equal(result.available,true);
 assert.equal(result.missingLiveMonths,1);
 assert.equal(result.cachedMonths,22);
 assert.equal(result.immutable,false);
 assert.deepEqual(f.scheduled.map(x=>x.month),["2025-05-01"]);
 assert.equal(f.scans.length,2);
 assert.deepEqual(f.scans[0].slice(1,4),["2025-05-01","2025-06-01","2025-05-01"]);
 assert.deepEqual(JSON.parse(f.scans[0][0]),[{id:1,code:"ABA"}]);
 assert.equal(result.sales.kpis.ventas,4800,
  "una farmacia cacheada y otra recalculada suman exactamente igual");
 assert.equal(result.sales.kpis.unidades,96);
 assert.equal(result.sales.kpis.margen,1440);
});
test("un histórico no consolidado no dispara 23 consultas originales",async()=>{
 const months=[];let month="2024-12-01";
 while(month<"2026-11-01"){
  months.push(month);
  const d=new Date(month+"T00:00:00Z");d.setUTCMonth(d.getUTCMonth()+1);
  month=d.toISOString().slice(0,10);
 }
 const f=fixture({missingMonths:months}),result=await f.read(request);
 assert.equal(result.available,false);
 assert.equal(result.reason,"pending");
 assert.equal(f.scans.length,0);
 assert.equal(f.scheduled.length,23);
});
test("dos extremos parciales nunca se almacenan como mes completo",async()=>{
 const f=fixture(),result=await f.read({...request,
  from:"2026-09-12",to:"2026-10-19"});
 assert.equal(result.available,true);
 assert.equal(result.cachedMonths,0);
 assert.equal(f.scans.length,2);
 assert.deepEqual(f.scans.map(x=>x.slice(1,4)),[
  ["2026-09-12","2026-10-01","2026-09-01"],
  ["2026-10-01","2026-10-20","2026-10-01"]
 ]);
});
