import test from "node:test";
import assert from "node:assert/strict";
import {buildDashboardMonthSQL,compatibleConsolidatedRange,
 summarizeConsolidations} from "./dashboardConsolidations.js";
import {createDashboardConsolidationService,setupDashboardConsolidations} from "./dashboardConsolidationService.js";

const month=(mes,fuente,{importe=0,unidades=0,filas=0,filas_importe=filas,
 filas_unidades=filas,filas_producto=filas,documentos=0,filas_coste=0,
 ventas_con_coste=0,margen_coste=0}={})=>({
 mes,fuente,importe,unidades,filas,filas_importe,filas_unidades,
 filas_producto,documentos,filas_coste,ventas_con_coste,margen_coste});
test("el consolidado agrupa meses cerrados y lee en vivo solo los extremos parciales",()=>{
 const today="2026-10-26";
 assert.equal(compatibleConsolidatedRange("2025-01-01","2025-12-31",today).months.length,12);
 assert.equal(compatibleConsolidatedRange("2023-11-01",today,today).months.length,35);
 assert.equal(compatibleConsolidatedRange("2023-11-01",today,today).active,true);
 assert.equal(compatibleConsolidatedRange("2026-10-01",today,today).months.length,0);
 assert.equal(compatibleConsolidatedRange("2025-06-01","2025-08-31",today).months.length,3);
 const first=compatibleConsolidatedRange("2025-06-07","2025-08-31",today);
 assert.deepEqual(first.months,["2025-07-01","2025-08-01"]);
 assert.deepEqual(first.liveRanges,[{from:"2025-06-07",to:"2025-06-30",month:"2025-06-01"}]);
 const last=compatibleConsolidatedRange("2025-06-01","2025-08-14",today);
 assert.deepEqual(last.months,["2025-06-01","2025-07-01"]);
 assert.deepEqual(last.liveRanges,[{from:"2025-08-01",to:"2025-08-14",month:"2025-08-01"}]);
 const custom=compatibleConsolidatedRange("2025-09-17","2026-10-17",today);
 assert.equal(custom.months.length,12);
 assert.deepEqual(custom.liveRanges,[
  {from:"2025-09-17",to:"2025-09-30",month:"2025-09-01"},
  {from:"2026-10-01",to:"2026-10-17",month:"2026-10-01"}
 ]);
 assert.equal(custom.active,true);
 const within=compatibleConsolidatedRange("2025-06-07","2025-06-14",today);
 assert.equal(within.months.length,0);
 assert.equal(within.liveRanges.length,1);
 assert.equal(compatibleConsolidatedRange("1900-01-01",today,today),null);
 assert.equal(compatibleConsolidatedRange("2026-11-01","2026-11-30",today),null);
});
test("agregación por farmacia y mes preserva devoluciones, márgenes y cobertura",()=>{
 const rows=[
  month("2025-06-01","ventas",{importe:120,unidades:20,filas:4,filas_coste:4,
   ventas_con_coste:120,margen_coste:48}),
  month("2025-06-01","compras",{importe:80,unidades:30,filas:3,documentos:2}),
  month("2025-07-01","ventas",{importe:150,unidades:25,filas:5,filas_coste:5,
   ventas_con_coste:150,margen_coste:52}),
  month("2025-07-01","compras",{importe:95,unidades:20,filas:2,documentos:2}),
  month("2025-08-01","ventas",{importe:90,unidades:12,filas:2,filas_coste:2,
   ventas_con_coste:90,margen_coste:30}),
  month("2025-08-01","compras",{importe:100,unidades:35,filas:3,documentos:3})
 ];
 const summary=summarizeConsolidations(rows,"2025-06-01","2025-08-31");
 assert.equal(summary.sales.kpis.ventas,360);
 assert.equal(summary.purchases.kpis.compras,275);
 assert.equal(summary.sales.kpis.unidades,57);
 assert.equal(summary.sales.kpis.margen,130);
 assert.equal(summary.purchases.kpis.recepciones,7);
 assert.deepEqual(summary.sales.monthly.map(r=>r.ventas),[120,150,90]);
 assert.deepEqual(summary.purchases.monthly.map(r=>r.compras),[80,95,100]);
});
test("compras mayores que ventas se conservan, nunca se reajustan ni excluyen",()=>{
 const rows=[month("2025-01-01","ventas",{importe:100,filas:1,filas_coste:1}),
  month("2025-01-01","compras",{importe:160,filas:1})];
 const result=summarizeConsolidations(rows,"2025-01-01","2025-01-31");
 assert.equal(result.sales.kpis.ventas,100);
 assert.equal(result.purchases.kpis.compras,160);
});
test("no confundir importes nulos con compras o ventas reales cero",()=>{
 const rows=[month("2025-01-01","ventas",
  {importe:75,filas:2,filas_importe:1,filas_coste:1}),
  month("2025-01-01","compras",
  {importe:25,filas:2,filas_importe:1})];
 const result=summarizeConsolidations(rows,"2025-01-01","2025-01-31");
 assert.equal(result.sales.hasAmounts,false);
 assert.equal(result.sales.kpis.ventas,null);
 assert.equal(result.sales.monthly[0].ventas,null);
 assert.equal(result.purchases.hasAmounts,false);
 assert.equal(result.purchases.kpis.compras,null);
 assert.equal(result.purchases.monthly[0].compras,null);
});
test("SQL utiliza índices por farmacia y fecha y respeta documentos completos",()=>{
 for(const origin of ["ventas","compras"]){
  const sql=buildDashboardMonthSQL("ampedia",origin);
  assert.match(sql,/h\.farmacia_codigo=f\.code AND h\.fecha >= \$2::date/);
  assert.match(sql,/h\.fecha < \$3::date AND h\.lineas_completas/);
  assert.match(sql,/NOT l\.eliminada_logicamente/);
  assert.match(sql,/JOIN "ampedia"\.fm_/);
  assert.match(sql,/lower\(btrim\(h\.estado\)\) NOT IN/);
  assert.doesNotMatch(sql,/upper\(btrim\(h\.farmacia_codigo\)\)/i);
 }
 const sale=buildDashboardMonthSQL("ampedia","ventas");
 assert.match(sale,/l\.importe_neto/);
 assert.match(sale,/coalesce\(l\.anulada,false\)=false/);
 const purchase=buildDashboardMonthSQL("ampedia","compras");
 assert.match(purchase,/l\.coste_neto/);
 assert.doesNotMatch(purchase,/l\.importe_neto/);
 assert.throws(()=>buildDashboardMonthSQL("ampedia;drop","ventas"));
});
test("sin todos los meses y farmacias no publica cifra parcial como total",async()=>{
 const statements=[];
 const pool={query:async(sql,params)=>{
  statements.push({sql,params});
  return {rows:[month("2025-01-01","ventas",{importe:100,filas:1})]};
 }};
 const service=createDashboardConsolidationService(pool,{now:()=>new Date("2026-10-26T12:00:00Z")});
 const result=await service.read({slug:"ampedia",schema:"ampedia",
  ids:[1,2],farms:[{id:1,code:"ABA"},{id:2,code:"EUR"}],
  from:"2025-01-01",to:"2025-12-31"});
 assert.equal(result.available,false);
 assert.equal(result.reason,"pending");
 assert.equal(result.expectedRows,48);
 assert.equal(statements.length,1);
});
test("un periodo histórico parcial suma doce meses cacheados y solo dos fragmentos vivos",async()=>{
 const today="2026-10-26",from="2025-09-17",to="2026-10-17";
 const months=compatibleConsolidatedRange(from,to,today).months;
 const cached=months.flatMap(m=>[
  month(m,"ventas",{importe:100,unidades:10,filas:1,filas_coste:1,
   ventas_con_coste:100,margen_coste:20}),
  month(m,"compras",{importe:50,unidades:4,filas:1,documentos:1})
 ]);
 const sqlCalls=[],liveCalls=[];
 const pool={
  query:async(sql,params)=>{sqlCalls.push({sql,params});return {rows:cached}},
  connect:async()=>({
   query:async(sql,params)=>{
    if(!params)return {rows:[]};
    liveCalls.push({sql,params});
    const sales=sql.includes(".fm_ventas_cabeceras");
    return {rows:[month(params[3],sales?"ventas":"compras",{
     importe:sales?10:5,unidades:sales?1:2,filas:1,filas_coste:sales?1:0,
     ventas_con_coste:sales?10:0,margen_coste:sales?2:0,documentos:sales?0:1
    })]};
   },
   release:()=>{}
  })
 };
 const service=createDashboardConsolidationService(pool,{now:()=>new Date("2026-10-26T12:00:00Z")});
 const result=await service.read({slug:"ampedia",schema:"ampedia",
  ids:[1],farms:[{id:1,code:"ABA"}],from,to});
 assert.equal(result.available,true);
 assert.equal(result.cachedMonths,12);
 assert.equal(result.liveRanges,2);
 assert.equal(result.liveCurrentMonth,true);
 assert.equal(result.sales.kpis.ventas,1220);
 assert.equal(result.purchases.kpis.compras,610);
 assert.equal(result.sales.kpis.margen,244);
 assert.deepEqual(sqlCalls[0].params,["ampedia",[1],"2025-10-01","2026-10-01"]);
 assert.equal(liveCalls.length,4);
 assert.deepEqual(liveCalls.map(c=>c.params.slice(1,4)),[
  ["2025-09-17","2025-10-01","2025-09-01"],
  ["2025-09-17","2025-10-01","2025-09-01"],
  ["2026-10-01","2026-10-18","2026-10-01"],
  ["2026-10-01","2026-10-18","2026-10-01"]
 ]);
 assert.equal(result.sales.monthly.length,14);
});
test("API aísla por tenant, farmacia autorizada y módulo dashboard",async()=>{
 const routes=new Map(),query=[];
 const pool={query:async(sql,params)=>{query.push({sql,params});return {rows:[]}}};
 setupDashboardConsolidations({get:(path,...m)=>routes.set(path,m.at(-1))},
  pool,{requireTenant:()=>[]});
 const call=async(farmacias,context)=>{
  let status=200,value;
  await routes.get("/api/analytics/dashboard/consolidados")({
   query:{desde:"2025-01-01",hasta:"2025-12-31",farmacias},
   context
  },{status(n){status=n;return this},json(x){value=x;return this}},
  error=>{if(error)throw error});
  return {status,value};
 };
 const ctx={role:"farmacia",modules:{dashboard:true},client:{slug:"ampedia",schema:"ampedia"},
  allowedPharmacyIds:[1],pharmacies:[{id:1,databaseCode:"ABA"}]};
 assert.equal((await call("2",ctx)).status,403);
 assert.equal((await call("1",{...ctx,modules:{dashboard:false}})).status,403);
 const ok=await call("1",ctx);
 assert.equal(ok.status,200);
 assert.equal(ok.value.available,false);
 assert.ok(query[0].sql.includes("dashboard_consolidados_mensuales"));
});
