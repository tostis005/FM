import test from "node:test";
import assert from "node:assert/strict";
import {panoramaPeriods,buildSalesPanoramaGroupSQL,mergePanoramaGroups,
 summarizePanoramaGroups,createSalesPanoramaCache,setupSalesPanorama} from "./salesPanorama.js";

const ctx={client:{slug:"ampedia",schema:"ampedia"},
 role:"gestor",modules:{ventas:true},allowedPharmacyIds:[1,2],
 pharmacies:[{id:"1",name:"Centro",databaseCode:"ABA"},
 {id:"2",name:"Norte",databaseCode:"NOR"}]};

test("solo se consolidan meses completos cerrados con reloj PostgreSQL",()=>{
 const a=panoramaPeriods("2026-09-01","2026-11-12","2026-11-12");
 assert.deepEqual(a.closed,["2026-09-01","2026-10-01"]);
 assert.deepEqual(a.live,[{from:"2026-11-01",to:"2026-11-12"}]);
 const b=panoramaPeriods("2026-09-09","2026-10-19","2026-11-12");
 assert.deepEqual(b.closed,[]);
 assert.deepEqual(b.live,[{from:"2026-09-09",to:"2026-09-30"},
  {from:"2026-10-01",to:"2026-10-19"}]);
 assert.equal(panoramaPeriods("2026-11-13","2026-11-14","2026-11-12"),null);
 assert.throws(()=>buildSalesPanoramaGroupSQL('bad";DROP SCHEMA;--'));
});
test("un único escaneo agrupa artículo original, vendedor y día/hora",()=>{
 const sql=buildSalesPanoramaGroupSQL("ampedia");
 assert.match(sql,/GROUP BY GROUPING SETS/);
 assert.match(sql,/v\.farmacia_codigo,v\.articulo_id/);
 assert.match(sql,/v\.farmacia_codigo,v\.vendedor_id/);
 assert.match(sql,/extract\(isodow FROM v\.fecha\)/);
 assert.match(sql,/v\.farmacia_codigo=ANY\(\$3::text\[\]\)/);
 assert.match(sql,/v\.fecha < \$2::date/);
 assert.match(sql,/sum\(v\.importe\),0\)::numeric/);
 assert.doesNotMatch(sql,/COUNT\(DISTINCT|GROUP BY .*documento_id/i);
});
test("fusiona grupos mensuales sin sumar dos veces una venta",()=>{
 const rows=mergePanoramaGroups([
  {code:"ABA",kind:"articulo",key:"123",sales:10,units:1,lines:1},
  {code:"ABA",kind:"articulo",key:"123",sales:20,units:2,lines:2},
  {code:"ABA",kind:"vendedor",key:"01",sales:30,units:3,lines:3},
  {code:"ABA",kind:"horario",key:"2:09",sales:30,units:3,lines:3}
 ]);
 assert.equal(rows.length,3);
 assert.equal(rows.find(r=>r.kind==="articulo").sales,30);
 const pool={query:async(sql)=>{
  if(sql.includes("familias_globales_articulos"))
   return {rows:[{code:"ABA",article:"123",familyId:"7",name:"Dermocosmética",segment:"PARAFARMACIA"}]};
  return {rows:[]};
 }};
 return summarizePanoramaGroups(pool,ctx,[1],rows).then(result=>{
  assert.equal(result.familias.totalSales,30);
  assert.equal(result.familias.families[0].name,"Dermocosmética");
  assert.equal(result.actividad.horarios.total,30);
  assert.equal(result.actividad.horarios.cells[0].weekday,2);
  assert.equal(result.actividad.vendedores.total,30);
 });
});
test("mes completo se escribe una sola vez y nunca modifica un consolidado",async()=>{
 let cached=false;const calls=[];
 const conn={async query(query){
  const sql=typeof query==="string"?query:query.text;
  calls.push(sql);
  if(sql.includes("pg_try_advisory_xact_lock"))return {rows:[{ok:true}]};
  if(sql.includes("SELECT 1 FROM farmetrica.ventas_panorama_meses_cerrados"))
   return {rows:cached?[{one:1}]:[]};
  return {rows:[]};
 },release(){}};
 const pool={query:async()=>({rows:[{today:"2026-11-12"}]}),
  connect:async()=>conn};
 const cache=createSalesPanoramaCache(pool,{logger:{info(){},error(){}}});
 const opts={slug:"ampedia",schema:"ampedia",id:1,code:"ABA",month:"2026-10-01"};
 assert.equal(await cache.refreshMonth(opts),true);
 const insert=calls.find(sql=>sql.includes("INSERT INTO farmetrica.ventas_panorama_mensual"));
 assert.match(insert,/GROUP BY GROUPING SETS/);
 assert.match(insert,/ON CONFLICT\(cliente_slug,farmacia_id,mes,dimension,clave\) DO NOTHING/);
 assert.ok(calls.some(sql=>sql.includes("INSERT INTO farmetrica.ventas_panorama_meses_cerrados")));
 assert.ok(calls.includes("COMMIT"));
 cached=true;const earlier=calls.length;
 assert.equal(await cache.refreshMonth(opts),true);
 assert.equal(calls.slice(earlier).some(sql=>sql.includes("INSERT INTO farmetrica.ventas_panorama_mensual")),false);
 assert.equal(await cache.refreshMonth({...opts,month:"2026-11-01"}),false);
});
test("histórico no precalculado devuelve preparación y no importes parciales",async()=>{
 const requests=[];
 const conn={async query(sql){
  if(String(sql).includes("pg_try_advisory_xact_lock"))return {rows:[{ok:false}]};
  return {rows:[]};
 },release(){}};
 const pool={async query(sql){requests.push(sql);
  if(String(sql).includes("clock_timestamp"))return {rows:[{today:"2026-11-12"}]};
  return {rows:[]};
 },connect:async()=>conn};
 const cache=createSalesPanoramaCache(pool,{logger:{info(){},error(){}}});
 const data=await cache.read({slug:"ampedia",schema:"ampedia",ids:[1],
  pharmacies:ctx.pharmacies,from:"2026-10-01",to:"2026-10-31",context:ctx});
 assert.equal(data.status,"preparing");
 assert.equal(data.missing,1);
 assert.ok(requests.some(s=>s.includes("ventas_panorama_meses_cerrados")));
 assert.ok(!requests.some(s=>s.includes("fm_ventas_analitica")));
});
test("API no revela datos de otras farmacias ni módulos",async()=>{
 const app={route:null,get(path,...args){if(path.endsWith("/panorama"))this.route=args.at(-1)}};
 const pool={async query(sql){
  if(String(sql).includes("clock_timestamp"))return {rows:[{today:"2026-11-12"}]};
  return {rows:[]};
 },async connect(){return {async query(s){
  if(String(s).includes("pg_try_advisory_xact_lock"))return {rows:[{ok:false}]};
  return {rows:[]};
 },release(){}}}};
 setupSalesPanorama(app,pool,{requireTenant:()=>[]});
 const run=async(query,context=ctx)=>{
  const response={code:200,status(n){this.code=n;return this},
   json(data){this.data=data;return this}};
  await app.route({context,query},response,e=>{if(e)throw e});
  return response;
 };
 const q={desde:"2026-10-01",hasta:"2026-10-31",farmacias:"1"};
 assert.equal((await run(q)).code,202);
 assert.equal((await run({...q,farmacias:"99"})).code,403);
 assert.equal((await run(q,{...ctx,modules:{ventas:false,dashboard:false}})).code,403);
 assert.equal((await run({...q,hasta:"2026-01-01"})).code,400);
});
