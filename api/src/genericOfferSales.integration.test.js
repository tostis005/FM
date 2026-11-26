import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {setupGenericOfferSales} from "./genericOfferSales.js";
import {setupGenericOpportunityMetrics} from "./genericOpportunityMetrics.js";
import {setupGenericosVentasFast} from "./genericosVentasFast.js";
import {setupSalesLaboratories} from "./salesLaboratories.js";
import {simulateOpportunity} from "./genericOpportunityModel.js";
test("unidades, facturación, devoluciones y cierres mensuales de genéricos en PostgreSQL",{skip:!process.env.TEST_DB_URL},async()=>{
 const db=new pg.Client({connectionString:process.env.TEST_DB_URL});await db.connect();
 try{
  await db.query("BEGIN");
  await db.query("INSERT INTO farmetrica.nomenclator_presentaciones(cn,nombre,dcpf,generico,principio_activo,descripcion_dcpf,laboratorio_comercializador) VALUES('799927','CI Genérico','9999912345',true,'CI MOLÉCULA','CI MOLÉCULA 10 mg 20 comprimidos','CI LAB') ON CONFLICT(cn) DO UPDATE SET dcpf=excluded.dcpf,generico=true");
  await db.query("INSERT INTO ampedia.articulos(farmacia_codigo,origen_id,nombre,codigo_nacional,laboratorio,stock_actual) VALUES('ABA','CI-GENERIC-ERP','CI Genérico','799927','CI LAB',10)");
  await db.query("INSERT INTO farmetrica.genericos_ofertas_laboratorios(cliente_slug,laboratorio_fuente,cn,pvl,descuento,neto,iva,puc,archivo_nombre,importado_por) VALUES('ampedia','CI LAB','799927',2,0,2,.04,2.08,'CI','CI')");
  await db.query("INSERT INTO ampedia.fm_ventas_cabeceras(farmacia_codigo,sistema_origen,documento_id,fecha,lineas_completas) VALUES('ABA','farmatic','CI-GENERIC-SALE','2026-10-21',true)");
  await db.query("INSERT INTO ampedia.fm_ventas_lineas(farmacia_codigo,sistema_origen,documento_id,linea_id,articulo_origen_id,cantidad,importe_neto,devuelta) VALUES('ABA','farmatic','CI-GENERIC-SALE','1','CI-GENERIC-ERP',10,30,false),('ABA','farmatic','CI-GENERIC-SALE','2','CI-GENERIC-ERP',2,6,true)");
  await db.query("INSERT INTO farmetrica.ventas_panorama_mensual(cliente_slug,farmacia_id,mes,dimension,clave,importe,unidades,lineas) VALUES('ampedia',1,'2026-09-01','articulo','CI-GENERIC-ERP',50,20,1)");
  await db.query("INSERT INTO farmetrica.ventas_panorama_meses_cerrados(cliente_slug,farmacia_id,mes) VALUES('ampedia',1,'2026-09-01') ON CONFLICT DO NOTHING");
  const routes=new Map(),app={get:(p,...h)=>routes.set(p,h.at(-1)),post:(p,...h)=>routes.set(p,h.at(-1))},guard={requireTenantModule:()=>[]};
  setupGenericOfferSales(app,db,guard);setupGenericOpportunityMetrics(app,db,guard);setupGenericosVentasFast(app,db,guard);
  const context={role:"gestor",client:{slug:"ampedia",schema:"ampedia"},allowedPharmacyIds:[1],modules:{genericos:true}};
  const dates={desde:"2026-09-01",hasta:"2026-10-21"};
  async function call(path,query,body){
   const res={code:200,status(c){this.code=c;return this},json(data){this.data=data;return this}};
   await routes.get(path)({context,query,body},res,e=>{throw e});
   assert.equal(res.code,200,JSON.stringify(res.data));return res.data;
  }
  const detail=await call("/api/genericos/ofertas/ventas",{}, {...dates,dcpfs:["9999912345"],farmacias:[1],detail:true});
  assert.equal(detail.salesAvailable,true,detail.warning);
  assert.equal(detail.items[0].units,28);assert.equal(detail.items[0].revenue,74);
  const opp=await call("/api/genericos/ofertas/oportunidades",{...dates,farmacias:"1",dcpf:"9999912345"});
  assert.equal(opp.salesAvailable,true,opp.warning);
  assert.equal(opp.items[0].salesUnits,28);assert.equal(opp.items[0].revenue,74);
  const analysis=await call("/api/genericos/ventas/metricas",{...dates,farmacias:"1"});
  assert.equal(analysis.salesAvailable,true,analysis.salesError);
  const row=analysis.sales.find(x=>x.dcpf==="9999912345");
  assert.equal(row.units,28);assert.equal(row.revenue,74);
  // Mismo producto vendido sin tarifa: usar política P20 global, con tres
  // compras a precios distintos. El destino sí tiene tarifa negociada.
  await db.query("INSERT INTO farmetrica.nomenclator_presentaciones(cn,nombre,dcpf,generico,laboratorio_comercializador) VALUES('799928','CI Histórico','9999912345',true,'CI LAB'),('799929','CI Alternativo','9999912345',true,'CI DESTINO')");
  await db.query("INSERT INTO ampedia.articulos(farmacia_codigo,origen_id,nombre,codigo_nacional,laboratorio,stock_actual) VALUES('ABA','CI-GENERIC-HIST','CI Histórico','799928','CI LAB',10)");
  await db.query("INSERT INTO farmetrica.genericos_ofertas_laboratorios(cliente_slug,laboratorio_fuente,cn,pvl,descuento,neto,iva,puc,archivo_nombre,importado_por) VALUES('ampedia','CI DESTINO','799929',2,.5,1,.04,1.04,'CI','CI')");
  await db.query("INSERT INTO ampedia.fm_ventas_lineas(farmacia_codigo,sistema_origen,documento_id,linea_id,articulo_origen_id,cantidad,importe_neto) VALUES('ABA','farmatic','CI-GENERIC-SALE','3','CI-GENERIC-HIST',10,45)");
  await db.query("INSERT INTO ampedia.fm_recepciones_cabeceras(farmacia_codigo,sistema_origen,documento_id,fecha,lineas_completas,proveedor_origen_id) VALUES('ABA','farmatic','CI-GENERIC-BUY','2026-10-20',true,'CI-HIST')");
  await db.query("INSERT INTO ampedia.fm_recepciones_lineas(farmacia_codigo,sistema_origen,documento_id,linea_id,articulo_origen_id,cantidad,coste_neto) VALUES('ABA','farmatic','CI-GENERIC-BUY','1','CI-GENERIC-HIST',10,30),('ABA','farmatic','CI-GENERIC-BUY','2','CI-GENERIC-HIST',10,40),('ABA','farmatic','CI-GENERIC-BUY','3','CI-GENERIC-HIST',10,50)");
  await db.query("INSERT INTO farmetrica.politica_precios(cliente_slug,farmacia_id,percentil,meses) VALUES('ampedia',1,20,6) ON CONFLICT(cliente_slug,farmacia_id) DO UPDATE SET percentil=20,meses=6");
  context.modules.ventas=true;context.modules.compras=true;
  setupSalesLaboratories(app,db,guard);
  const cmp=await call("/api/genericos/ofertas/oportunidades",{...dates,farmacias:"1",dcpf:"9999912345"});
  assert.equal(cmp.salesAvailable,true,cmp.warning);
  assert.equal(cmp.purchasesAvailable,true,cmp.warning);
  const hist=cmp.items[0].sources.find(x=>x.cn==="799928");
  assert.equal(hist.net,3);assert.equal(hist.percentile,20);
  const res=await call("/api/analytics/ventas/laboratorios/analisis",{...dates,farmacias:"1",laboratorio:"CI LAB",parte:"ahorro"});
  const product=res.products.find(x=>x.cn==="799928");
  assert.equal(product.sourcePriceType,"history");
  assert.equal(product.sourceNet,3);assert.equal(product.targetNet,1);
  assert.equal(product.saving,20);
  assert.equal(product.saving,simulateOpportunity(cmp.items[0].sources.filter(x=>x.cn==="799928"),product.targetNet,100));
  const tariff=res.products.find(x=>x.cn==="799927");
  assert.equal(tariff.sourcePriceType,"tariff");assert.equal(tariff.saving,28);
  assert.equal(tariff.saving,simulateOpportunity(cmp.items[0].sources.filter(x=>x.cn==="799927"),tariff.targetNet,100));
 }finally{await db.query("ROLLBACK").catch(()=>{});await db.end()}
});
