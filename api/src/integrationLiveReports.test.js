import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {setupRealReports} from "./realReports.js";
import {setupSalesSummary} from "./salesSummary.js";
import {setupSalesTotals} from "./salesTotals.js";
import {setupSalesInsights} from "./salesInsights.js";
import {setupSalesDetail} from "./salesDetail.js";
import {setupDemoClients} from "./demoClients.js";
import {setupGenericosReales} from "./genericosReales.js";
const enabled=Boolean(process.env.TEST_DB_URL);
test("PostgreSQL: consultas reales de artículos, compras, ventas y grupos DCPF",{
 skip:!enabled
},async()=>{
 const pool=new pg.Pool({connectionString:process.env.TEST_DB_URL});
 const routes={},app={get(path,...handlers){routes[path]=handlers.at(-1)},
  post(path,...handlers){routes[path]=handlers.at(-1)}};
 setupRealReports(app,pool,{requireTenant:()=>[]});
 setupSalesSummary(app,pool,{requireTenant:()=>[]});
 setupSalesTotals(app,pool,{requireTenant:()=>[]});
 setupSalesInsights(app,pool,{requireTenant:()=>[]});
 setupSalesDetail(app,pool,{requireTenant:()=>[]});
 setupDemoClients(app,pool,{requireSuperadmin:()=>[]});
 setupGenericosReales(app,pool,{requireTenantModule:()=>[]});
 const ctx={client:{slug:"ampedia",schema:"ampedia"},role:"superadministrador",
  modules:{},allowedPharmacyIds:[1,2,5],pharmacies:[{id:"1",sourceCode:"ABA"},{id:"2",sourceCode:"EUR"},{id:"5",sourceCode:"POL",databaseCode:"VAL",displayCode:"POL"}]};
 async function request(path,params={},payload={},context=ctx){
  const req={query:{desde:"2026-10-01",hasta:"2026-10-18",farmacias:"1",...params},
    params:{dcpf:"123456789"},context,user:{email:"qa@example.com"},body:payload};
  let status=200,body;
  const res={status(n){status=n;return res},json(data){body=data;return res}};
  const handler=routes[path]||(path.startsWith("/api/genericos/reales/")?routes["/api/genericos/reales/:dcpf"]:null);
  assert.equal(typeof handler,"function","Ruta de prueba no registrada: "+path);
  let error;await handler(req,res,e=>{error=e});
  if(error)throw error;
  assert.ok(status===200||(path==="/api/admin/clientes/demo"&&status===201),JSON.stringify(body));
  return body;
 }
 try{
  const reports=await request("/api/analytics/reportes",{modulo:"compras"});
  assert.equal(reports.available,true);
  assert.ok(reports.kpis.compras>0);
  assert.equal(reports.kpis.ventas,null,"Compras no solicita la serie mensual de ventas");
  // Regresión: los clientes creados con la estructura antigua también
  // deben mostrar compras reales aunque carezcan de tabla articulos/ventas.
  await pool.query(`CREATE SCHEMA legacy_reports_ci`);
  await pool.query(`CREATE TABLE legacy_reports_ci.productos (
    id text PRIMARY KEY, cn text, descripcion text NOT NULL, familia text)`);
  await pool.query(`CREATE TABLE legacy_reports_ci.proveedores (
    id text PRIMARY KEY, nombre text NOT NULL)`);
  await pool.query(`CREATE TABLE legacy_reports_ci.compras (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    farmacia_id integer NOT NULL, proveedor_id text, producto_id text,
    fecha timestamptz NOT NULL, unidades numeric, puc numeric, total numeric)`);
  await pool.query(`INSERT INTO farmetrica.clientes(slug,nombre,esquema_datos)
    VALUES ('legacy_reports_ci','Tenant legado CI','legacy_reports_ci')`);
  const {rows:[legacyPharmacy]}=await pool.query(`INSERT INTO farmetrica.farmacias
    (cliente_slug,nombre,codigo_origen) VALUES
    ('legacy_reports_ci','Farmacia legado','LGC') RETURNING id`);
  await pool.query(`INSERT INTO legacy_reports_ci.productos VALUES
    ('ID01','123456','Producto legado','Test')`);
  await pool.query(`INSERT INTO legacy_reports_ci.proveedores VALUES
    ('PR1','Proveedor legado')`);
  await pool.query(`INSERT INTO legacy_reports_ci.compras
    (farmacia_id,proveedor_id,producto_id,fecha,unidades,puc,total)
    VALUES ($1,'PR1','ID01','2026-10-10',6,2.5,15)`,[legacyPharmacy.id]);
  const legacyContext={client:{slug:"legacy_reports_ci",schema:"legacy_reports_ci"},
    role:"superadministrador",modules:{},allowedPharmacyIds:[legacyPharmacy.id],
    pharmacies:[{id:String(legacyPharmacy.id),sourceCode:"LGC"}]};
  const legacyReport=await request("/api/analytics/reportes",
    {modulo:"compras",farmacias:String(legacyPharmacy.id)}, {},legacyContext);
  assert.equal(legacyReport.available,true);
  assert.equal(legacyReport.kpis.compras,15);
  assert.equal(legacyReport.kpis.unidadesCompradas,6);
  assert.equal(legacyReport.kpis.lineasCompra,1);
  assert.equal(legacyReport.buyRows[0].cn,"123456");
  assert.equal(legacyReport.buyRows[0].puc,2.5);
  assert.equal(legacyReport.supplierRows[0].name,"Proveedor legado");
  await pool.query(`CREATE TABLE legacy_reports_ci.stock (
    farmacia_id integer NOT NULL,producto_id text NOT NULL,
    unidades numeric,coste_unitario numeric,fecha_referencia timestamptz NOT NULL)`);
  await pool.query(`INSERT INTO legacy_reports_ci.stock
    VALUES ($1,'ID01',4,2.5,now())`,[legacyPharmacy.id]);
  const legacyStockReport=await request("/api/analytics/reportes",
    {modulo:"stock",farmacias:String(legacyPharmacy.id)}, {},legacyContext);
  assert.equal(legacyStockReport.availability.stock,true);
  assert.equal(legacyStockReport.availability.stockSource,"stock");
  assert.equal(legacyStockReport.stockRows[0].cn,"123456");
  assert.equal(legacyStockReport.stockRows[0].value,10);
  assert.equal(legacyStockReport.kpis.stock,10);

  const dashboard=await request("/api/analytics/reportes",{modulo:"dashboard"});
  assert.ok(dashboard.kpis.ventas>0,"Dashboard sí consulta el total de ventas");
  assert.ok(reports.buyRows.some(r=>r.cn==="654321"&&r.puc>0));
  assert.ok(reports.salesRows.some(r=>r.cn==="654322"));
  assert.ok(reports.supplierRows.some(r=>r.name==="Mayorista 2"));
  // Smoke test del resto de reportes usando datos reales del fixture:
  // se comprueban módulos, esquema, importes y estructuras sin generar mocks.
  for(const module of ["dashboard","rentabilidad","reposicion","acciones","informes","asistente"]){
   const report=await request("/api/analytics/reportes",{modulo:module});
   assert.equal(report.available,true,"Debe estar operativo "+module);
   assert.ok(report.kpis&&typeof report.kpis==="object",module+" debe incluir indicadores");
   assert.ok(Array.isArray(report.monthly),module+" debe devolver serie temporal");
  }
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
  // El catálogo ERP sincronizado dispone del stock de cada artículo.
  // Debe prevalecer sobre la vieja tabla de instantáneas, también en VAL.
  await pool.query("ALTER TABLE ampedia.articulos ADD COLUMN IF NOT EXISTS stock_actual numeric");
  await pool.query("UPDATE ampedia.articulos SET stock_actual=CASE WHEN farmacia_codigo='ABA' AND origen_id='ART-01' THEN 8 WHEN farmacia_codigo='ABA' THEN 3 ELSE 9 END, sincronizado_en=now()");
  const stockFromArticles=await request("/api/analytics/reportes",{modulo:"stock",farmacias:"1,2"});
  assert.equal(stockFromArticles.availability.stock,true);
  assert.equal(stockFromArticles.availability.stockSource,"articulos");
  assert.equal(stockFromArticles.stockRows.find(r=>r.pharmacyId==="1"&&r.cn==="654321").units,8);
  assert.equal(stockFromArticles.stockRows.find(r=>r.pharmacyId==="2"&&r.cn==="654321").units,9);
  assert.ok(stockFromArticles.kpis.stock>0);
  assert.equal(stockFromArticles.kpis.stockArticulos,3);
  assert.equal(stockFromArticles.kpis.stockUnidades,20);
  assert.equal(stockFromArticles.kpis.stock,48.5);
  assert.equal(stockFromArticles.availability.stockSummaryBasis,"PMC de ficha (todos los artículos)");

  const stockFromDemo=await request("/api/analytics/reportes",{modulo:"reposicion",farmacias:"1,2"});
  assert.ok(Array.isArray(stockFromDemo.replenishmentRows));

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
  const detailVal=await request("/api/analytics/ventas/detalle",{
   farmacias:"5",desde:"2025-11-01",hasta:"2026-10-18",pagina:"1"});
  assert.ok(detailVal.products.some(p=>p.pharmacyId==="5"&&p.cn==="654321"&&p.abcdClass==="A"));
  const priced=detailVal.products.find(p=>p.pharmacyId==="5"&&p.cn==="654321");
  assert.ok(priced.pvp>0,"PVP de la ficha de artículo");
  assert.equal(priced.saleUnitPrice,7,"Importe de ventas dividido por unidades");
  assert.ok(priced.purchaseCost>0,"PUC real ponderado o PMC");
  assert.ok(Math.abs(priced.unitMargin-(priced.saleUnitPrice-priced.purchaseCost))<.0002);
  assert.ok(Math.abs(priced.margin-(priced.value-priced.units*priced.purchaseCost))<.02);
  assert.equal(detailVal.hasMore,false);
  const detailFamily=await request("/api/analytics/ventas/detalle",{
   farmacias:"5",familias:"Digestivo",desde:"2025-11-01",hasta:"2026-10-18"});
  assert.equal(detailFamily.products.length,1);
  const detailNext=await request("/api/analytics/ventas/detalle",{
   farmacias:"5",pagina:"2",desde:"2025-11-01",hasta:"2026-10-18"});
  assert.equal(detailNext.products.length,0);
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
  // Demo privada sin copia de movimientos: esquema propio + vistas no
  // actualizables y farmacias con nombres ficticios. No se tocan datos reales.
  const created=await request("/api/admin/clientes/demo",{},
    {slug:"demo_ci_qa",name:"Demo de comprobación",sourceSlug:"ampedia"});
  assert.equal(created.demo,true);
  const {rows:fake}=await pool.query(
    "SELECT nombre,codigo_origen FROM farmetrica.farmacias WHERE cliente_slug='demo_ci_qa' ORDER BY id");
  assert.ok(fake.length>=2);
  assert.ok(fake.every(x=>x.nombre.startsWith("Farmacia Demo ")));
  assert.equal(fake.find(x=>x.codigo_origen==="VAL")?.nombre.startsWith("Farmacia Demo "),true);
  const {rows:views}=await pool.query(
    "SELECT c.relname,pg_relation_is_updatable(c.oid,false) AS rights FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='demo_ci_qa' AND c.relname IN ('ventas','compras','articulos')");
  assert.equal(views.length,3);
  assert.ok(views.every(x=>Number(x.rights)===0),"Las vistas demo no deben aceptar INSERT/UPDATE/DELETE");
  const {rows:sourceCount}=await pool.query("SELECT count(*)::int AS n FROM ampedia.ventas WHERE farmacia_codigo='VAL'");
  const {rows:demoCount}=await pool.query("SELECT count(*)::int AS n FROM demo_ci_qa.ventas WHERE farmacia_codigo='VAL'");
  assert.equal(demoCount[0].n,sourceCount[0].n,"Demo comparte datos vivos en solo lectura");
  // Más de 3.000 referencias: no confundir el límite visual con el inventario
  // real. El SUM y el contador se calculan sobre todas las fichas seleccionadas.
  await pool.query(`INSERT INTO ampedia.articulos
    (farmacia_codigo,origen_id,nombre,codigo_nacional,familia,pmc,pvp,stock_actual)
    SELECT 'ABA','BULK-'||i,'Inventario prueba '||i,
      'EXTRA-'||i,'Prueba',1,3,1 FROM generate_series(1,3005) i`);
  const completeCount=await request("/api/analytics/reportes",{modulo:"stock",farmacias:"1,2"});
  assert.equal(completeCount.stockRows.length,3000);
  assert.equal(completeCount.kpis.stockArticulos,3008);
  assert.equal(completeCount.kpis.stockUnidades,3025);
  assert.equal(completeCount.kpis.stock,3053.5);


 }finally{await pool.end()}
});
