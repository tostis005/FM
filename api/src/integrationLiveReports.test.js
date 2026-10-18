import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {setupRealReports} from "./realReports.js";
import {setupSalesSummary} from "./salesSummary.js";
import {setupSalesTotals} from "./salesTotals.js";
import {setupSalesInsights} from "./salesInsights.js";
import {setupGenericosReales} from "./genericosReales.js";
const enabled=Boolean(process.env.TEST_DB_URL);
test("PostgreSQL: consultas reales de artículos, compras, ventas y grupos DCPF",{
 skip:!enabled
},async()=>{
 const pool=new pg.Pool({connectionString:process.env.TEST_DB_URL});
 const routes={},app={get(path,...handlers){routes[path]=handlers.at(-1)}};
 setupRealReports(app,pool,{requireTenant:()=>[]});
 setupSalesSummary(app,pool,{requireTenant:()=>[]});
 setupSalesTotals(app,pool,{requireTenant:()=>[]});
 setupSalesInsights(app,pool,{requireTenant:()=>[]});
 setupGenericosReales(app,pool,{requireTenantModule:()=>[]});
 const ctx={client:{slug:"ampedia",schema:"ampedia"},role:"superadministrador",
  modules:{},allowedPharmacyIds:[1,2,5],pharmacies:[{id:"1",sourceCode:"ABA"},{id:"2",sourceCode:"EUR"},{id:"5",sourceCode:"POL",databaseCode:"VAL",displayCode:"POL"}]};
 async function request(path,params={}){
  const req={query:{desde:"2026-10-01",hasta:"2026-10-18",farmacias:"1",...params},
    params:{dcpf:"123456789"},context:ctx,user:{email:"qa@example.com"}};
  let status=200,body;
  const res={status(n){status=n;return res},json(data){body=data;return res}};
  const handler=routes[path]||(path.startsWith("/api/genericos/reales/")?routes["/api/genericos/reales/:dcpf"]:null);
  assert.equal(typeof handler,"function","Ruta de prueba no registrada: "+path);
  let error;await handler(req,res,e=>{error=e});
  if(error)throw error;
  assert.equal(status,200,JSON.stringify(body));
  return body;
 }
 try{
  const reports=await request("/api/analytics/reportes",{modulo:"compras"});
  assert.equal(reports.available,true);
  assert.ok(reports.kpis.compras>0);
  assert.ok(reports.kpis.ventas>0);
  assert.ok(reports.buyRows.some(r=>r.cn==="654321"&&r.puc>0));
  assert.ok(reports.salesRows.some(r=>r.cn==="654322"));
  assert.ok(reports.supplierRows.some(r=>r.name==="Mayorista 2"));
  const groups=await request("/api/genericos/reales");
  assert.ok(groups.groups.find(r=>r.dcpf==="123456789"&&r.genericCount===2));
  const g=groups.groups.find(r=>r.dcpf==="123456789");
  assert.ok(g.averagePuc>0 && g.averagePvp>g.averagePuc);
  assert.ok(g.pvpMarginPct>0);
  assert.ok(g.bestPuc>0);
  assert.ok(g.indicativeSavings>0);
  const detail=await request("/api/genericos/reales/123456789");
  assert.equal(detail.products.length,2);
  assert.equal(detail.purchases.length,2);
  assert.ok(detail.purchases.some(r=>r.referencePuc>0));
  // IDs proveedor iguales en ERP diferentes no comparten nombre ni gasto.
  const multi=await request("/api/analytics/reportes",{modulo:"proveedores",farmacias:"1,2"});
  const sameCode=multi.supplierRows.filter(r=>r.providerId==="PR1");
  assert.equal(sameCode.length,2);
  assert.equal(new Set(sameCode.map(r=>r.id)).size,2);
  assert.deepEqual(new Set(sameCode.map(r=>r.name)),new Set(["Mayorista 1","Mayorista Europa"]));
  assert.deepEqual(new Set(sameCode.map(r=>r.pharmacyId)),new Set(["1","2"]));
  // Existencias: no basta con que una de las farmacias se haya refrescado.
  const oldStock=await request("/api/analytics/reportes",{modulo:"stock",farmacias:"1,2"});
  assert.equal(oldStock.availability.stock,false);
  assert.equal(oldStock.stockRows.length,0);
  assert.equal(oldStock.kpis.stock,null);
  // Una vez ambas farmacias están frescas, el ID ART-03 debe resolverse al CN
  // de su propia farmacia para relacionarlo con el PUC real y el PMC.
  await pool.query("UPDATE public.stock_farmacia SET importado_en=now() WHERE id_farmacia=2");
  const freshStock=await request("/api/analytics/reportes",{modulo:"stock",farmacias:"1,2"});
  assert.equal(freshStock.availability.stock,true);
  const abc=freshStock.stockRows.find(r=>r.pharmacyId==="1"&&r.cn==="654321");
  const eur=freshStock.stockRows.find(r=>r.pharmacyId==="2"&&r.cn==="654321");
  assert.equal(abc.units,8);
  assert.equal(eur.units,9);
  assert.ok(abc.value>0);
  assert.ok(eur.value>0);
  assert.ok(freshStock.kpis.stock>0);
  // Totales simples: 12 meses, Valdemarías y farmacia adicional, sin compras.
  const fastVal=await request("/api/analytics/ventas/totales",{
   farmacias:"5",desde:"2025-11-01",hasta:"2026-10-18",granularidad:"month"});
  assert.equal(fastVal.kpis.ventas,28);
  assert.equal(fastVal.kpis.unidades,4);
  assert.ok(fastVal.monthly.some(r=>r.month==="2026-10"&&r.ventas===28));
  assert.ok(fastVal.series.some(r=>r.bucket==="2026-10"&&r.ventas===28));
  const fastTwo=await request("/api/analytics/ventas/totales",{
   farmacias:"1,5",granularidad:"day"});
  assert.ok(fastTwo.kpis.ventas>28);
  assert.ok(fastTwo.series.some(r=>r.bucket==="2026-10-11"));
  const counters=await request("/api/analytics/ventas/recuento",{
   farmacias:"5",desde:"2025-11-01",hasta:"2026-10-18"});
  assert.equal(counters.totalProducts,1);
  assert.equal(counters.totalArticles,1);
  const families=await request("/api/analytics/ventas/familias",{farmacias:"5"});
  assert.deepEqual(families.families.map(f=>f.code),["Digestivo"]);
  const networkFamilies=await request("/api/analytics/ventas/familias",{farmacias:"1,5"});
  assert.deepEqual(networkFamilies.families,[]);
  const allHistory=await request("/api/analytics/ventas/totales",{
   farmacias:"5",desde:"1900-01-01",hasta:"2026-10-18"});
  assert.equal(allHistory.kpis.ventas,28);
  // Una consulta SQL agrega gráfico, indicadores y ABCD sin peticiones adicionales.
  const salesSummary=await request("/api/analytics/ventas/resumen",{
   farmacias:"5",granularidad:"month"});
  assert.equal(salesSummary.kpis.ventas,28);
  assert.equal(salesSummary.kpis.unidades,4);
  assert.equal(salesSummary.kpis.articulosVendidos,1);
  assert.equal(salesSummary.totalProducts,1);
  assert.equal(salesSummary.totalArticles,1);
  assert.equal(salesSummary.products[0].pharmacyId,"5");
  assert.equal(salesSummary.products[0].abcdClass,"A");
  assert.equal(salesSummary.products[0].cn,"654321");
  assert.ok(salesSummary.series.length>0);
  assert.ok(salesSummary.monthly.length>0);
  const byFamily=await request("/api/analytics/ventas/resumen",{
   farmacias:"5",granularidad:"day",familias:"Digestivo"});
  assert.equal(byFamily.kpis.ventas,28);
  const noMatch=await request("/api/analytics/ventas/resumen",{
   farmacias:"5",buscar:"SIN-COINCIDENCIAS"});
  assert.equal(noMatch.kpis.ventas,0);
  assert.equal(noMatch.totalArticles,0);
  // Datos VAL deben corresponder a farmacia 5 sin modificar el maestro POL.
  const val=await request("/api/analytics/reportes",{modulo:"ventas",farmacias:"5"});
  assert.equal(val.kpis.ventas,28);
  assert.ok(val.salesRows.some(r=>r.pharmacyId==="5"&&r.cn==="654321"&&r.units===4));
  assert.equal(val.kpis.compras,0); // No inventar compras donde el ERP no ha sincronizado.
  const master=await pool.query("SELECT codigo_origen FROM farmetrica.farmacias WHERE cliente_slug='ampedia' AND id=5");
  assert.equal(master.rows[0].codigo_origen,"POL");
 }finally{await pool.end()}
});
