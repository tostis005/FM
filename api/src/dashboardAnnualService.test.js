import test from "node:test";
import assert from "node:assert/strict";
import {createDashboardAnnualService,splitConsolidatedYears,buildAnnualInsertSQL} from "./dashboardAnnualService.js";
import {createDashboardConsolidationService} from "./dashboardConsolidationService.js";

test("ejercicio anual solo se compone de doce meses completos",()=>{
 const months=Array.from({length:12},(_,i)=>"2025-"+String(i+1).padStart(2,"0")+"-01");
 assert.deepEqual(splitConsolidatedYears(months),{years:[2025],months:[]});
 const split=splitConsolidatedYears([...months.slice(1),"2026-01-01"]);
 assert.deepEqual(split.years,[]);
 assert.equal(split.months.length,12);
 const sql=buildAnnualInsertSQL();
 assert.match(sql,/FROM farmetrica\.dashboard_consolidados_mensuales/);
 assert.match(sql,/HAVING count\(\*\)=12/);
 assert.match(sql,/jsonb_agg\(to_jsonb\(m\) ORDER BY m\.mes\)/);
 assert.match(sql,/ON CONFLICT\(cliente_slug,farmacia_id,anio,fuente\) DO NOTHING/);
 assert.doesNotMatch(sql,/DO UPDATE|fm_ventas_analitica|fm_ventas_lineas/);
});
test("anual existente no cambia y ejercicio actual no se cierra",async()=>{
 const calls=[];
 const conn={async query(sql,values){
  calls.push({sql,values});
  if(sql.includes("pg_try_advisory_xact_lock"))return {rows:[{ok:true}]};
  if(sql.includes("SELECT count(*)"))return {rows:[{n:2}]};
  return {rows:[]};
 },release(){}};
 const service=createDashboardAnnualService({connect:async()=>conn},{
  dbClock:async()=>({today:"2026-11-12",hour:9})});
 const scope={slug:"ampedia",farms:[{id:1,code:"ABA"}]};
 assert.equal(await service.refreshYear({...scope,year:2026}),false);
 assert.equal(calls.length,0);
 assert.equal(await service.refreshYear({...scope,year:2025}),false);
 assert.ok(calls.some(r=>r.sql.includes("SELECT count(*)")));
 assert.equal(calls.filter(r=>r.sql.includes("INSERT INTO")).length,0);
});
test("anual ausente se inserta una vez sin volver a escanear documentos",async()=>{
 const calls=[];
 const conn={async query(sql,values){
  calls.push({sql,values});
  if(sql.includes("pg_try_advisory_xact_lock"))return {rows:[{ok:true}]};
  if(sql.includes("SELECT count(*)"))return {rows:[{n:0}]};
  return {rows:[]};
 },release(){}};
 const service=createDashboardAnnualService({connect:async()=>conn},{
  dbClock:async()=>({today:"2026-11-12",hour:9})});
 assert.equal(await service.refreshYear({slug:"ampedia",year:2025,
  farms:[{id:1,code:"ABA"},{id:2,code:"EUR"}]}),true);
 const insert=calls.find(c=>c.sql.includes("INSERT INTO farmetrica.dashboard_consolidados_anuales"));
 assert.deepEqual(insert.values,["ampedia",2025,[1,2]]);
 assert.match(insert.sql,/DO NOTHING/);
 assert.equal(calls.filter(c=>c.sql==="COMMIT").length,1);
});
test("lectura de anual completo conserva los doce meses y cada farmacia/fuente",async()=>{
 const months=Array.from({length:12},(_,i)=>({mes:"2025-"+String(i+1).padStart(2,"0")+"-01",
  importe:10,unidades:2,filas:1,filas_importe:1,fuente:"ventas"}));
 const rows=[{farmacia_id:1,anio:2025,fuente:"ventas",meses:months},
  {farmacia_id:1,anio:2025,fuente:"compras",meses:months}];
 const service=createDashboardAnnualService({query:async()=>({rows})},{
  dbClock:async()=>({today:"2026-11-12",hour:9})});
 const result=await service.readYears({slug:"ampedia",ids:[1],years:[2025]});
 assert.deepEqual(result.matchedYears,[2025]);
 assert.equal(result.rows.length,24);
 assert.equal(result.rows.filter(x=>x.fuente==="compras").length,12);
 const missing=await service.readYears({slug:"ampedia",ids:[1,2],years:[2025]});
 assert.deepEqual(missing.matchedYears,[]);
 assert.equal(missing.rows.length,0);
});
test("un mes consolidado nunca se actualiza ni se reabre por devoluciones tardías",async()=>{
 const writes=[];
 let present=0;
 const conn={async query(sql,values){
  if(sql.includes("pg_try_advisory_xact_lock"))return {rows:[{ok:true}]};
  if(sql.includes("SELECT count(*)"))return {rows:[{n:present}]};
  if(sql.includes("INSERT INTO farmetrica.dashboard_consolidados_mensuales"))
   writes.push({sql,values});
  return {rows:[]};
 },release(){}};
 const pool={connect:async()=>conn};
 const service=createDashboardConsolidationService(pool,{
  now:()=>new Date("2026-11-12T09:00:00Z")});
 const scope={slug:"ampedia",schema:"ampedia",farms:[{id:1,code:"ABA"}],month:"2026-10-01"};
 assert.equal(await service.refreshMonth(scope),true);
 assert.equal(writes.length,2);
 for(const write of writes){
  assert.match(write.sql,/ON CONFLICT \(cliente_slug,farmacia_id,mes,fuente\) DO NOTHING/);
  assert.doesNotMatch(write.sql,/DO UPDATE/);
 }
 present=2;
 assert.equal(await service.refreshMonth(scope,true),false);
 assert.equal(writes.length,2);
 assert.equal(await service.refreshMonth({...scope,month:"2026-11-01"}),false);
 assert.equal(writes.length,2);
});
