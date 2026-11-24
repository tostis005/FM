import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {setupSalesLaboratories} from "./salesLaboratories.js";
test("laboratory analysis on PostgreSQL: ERP mapping, net returns, tariff saving and direct supplier",{
 skip:!process.env.TEST_DB_URL
},async()=>{
 const db=new pg.Client({connectionString:process.env.TEST_DB_URL});await db.connect();
 try{
  await db.query("BEGIN");
  await db.query("INSERT INTO farmetrica.nomenclator_presentaciones (cn,nombre,dcpf,generico,laboratorio_comercializador) VALUES ('791921','Producto de prueba','CI-LAB-VENTAS',true,'CI LAB VENTAS'),('791922','Alternativa de prueba','CI-LAB-VENTAS',true,'CI DESTINO VENTAS') ON CONFLICT(cn) DO UPDATE SET nombre=excluded.nombre,dcpf=excluded.dcpf,generico=true,laboratorio_comercializador=excluded.laboratorio_comercializador");
  await db.query("INSERT INTO ampedia.articulos(farmacia_codigo,origen_id,nombre,codigo_nacional,laboratorio,stock_actual) VALUES('ABA','CI-LAB-V-ERP','Producto de prueba','791921','CI LAB VENTAS',10)");
  await db.query("INSERT INTO ampedia.fm_ventas_cabeceras(farmacia_codigo,sistema_origen,documento_id,fecha,lineas_completas) VALUES('ABA','farmatic','CI-LAB-V-SALE','2026-10-21',true)");
  await db.query("INSERT INTO ampedia.fm_ventas_lineas(farmacia_codigo,sistema_origen,documento_id,linea_id,articulo_origen_id,cantidad,importe_neto,devuelta) VALUES('ABA','farmatic','CI-LAB-V-SALE','1','CI-LAB-V-ERP',10,30,false),('ABA','farmatic','CI-LAB-V-SALE','2','CI-LAB-V-ERP',2,6,true)");
  const supplier=(await db.query("INSERT INTO farmetrica.proveedores_unificados(cliente_slug,clave_unificada,nombre,clase) VALUES('ampedia','CI-LAB-V-DIRECT','CI LAB VENTAS','DIRECTO') RETURNING id")).rows[0].id;
  await db.query("INSERT INTO farmetrica.proveedores_unificados_alias(cliente_slug,proveedor_id,farmacia_codigo,codigo_origen) VALUES('ampedia',$1,'ABA','CI-LAB-V-SUPPLIER')",[supplier]);
  await db.query("INSERT INTO ampedia.fm_recepciones_cabeceras(farmacia_codigo,sistema_origen,documento_id,fecha,lineas_completas,proveedor_origen_id) VALUES('ABA','farmatic','CI-LAB-V-BUY','2026-10-21',true,'CI-LAB-V-SUPPLIER')");
  await db.query("INSERT INTO ampedia.fm_recepciones_lineas(farmacia_codigo,sistema_origen,documento_id,linea_id,articulo_origen_id,cantidad,coste_neto) VALUES('ABA','farmatic','CI-LAB-V-BUY','1','CI-LAB-V-ERP',9,18)");
  await db.query("INSERT INTO farmetrica.genericos_ofertas_laboratorios(cliente_slug,laboratorio_fuente,cn,pvl,descuento,neto,iva,puc,archivo_nombre,importado_por) VALUES('ampedia','CI LAB VENTAS','791921',4,.5,2,.04,2.08,'CI','CI'),('ampedia','CI DESTINO VENTAS','791922',4,.75,1,.04,1.04,'CI','CI')");
  const routes=new Map();
  setupSalesLaboratories({get:(p,...h)=>routes.set(p,h.at(-1))},db,{requireTenantModule:()=>[]});
  const context={role:"gestor",client:{slug:"ampedia",schema:"ampedia"},allowedPharmacyIds:[1],modules:{ventas:true,compras:true,genericos:true},sections:{ventas:true,compras:true,genericos:true}};
  async function call(path,query){
   const res={code:200,status(c){this.code=c;return this},json(body){this.body=body;return this}};
   await routes.get(path)({context,query},res,e=>{throw e});assert.equal(res.code,200);return res.body;
  }
  const options=await call("/api/analytics/ventas/laboratorios",{farmacias:"1"});
  assert.ok(options.items.some(x=>x.key==="CI LAB VENTAS"));
  const q={laboratorio:"CI LAB VENTAS",farmacias:"1",desde:"2026-10-21",hasta:"2026-10-21"};
  const report=await call("/api/analytics/ventas/laboratorios/analisis",q);
  assert.deepEqual(report.warnings,[]);
  assert.equal(report.summary.salesUnits,8);assert.equal(report.summary.revenue,24);
  assert.equal(report.summary.purchaseUnits,9);assert.equal(report.summary.purchaseAmount,18);
  assert.equal(report.summary.directUnits,9);assert.equal(report.summary.directAmount,18);
  assert.equal(report.summary.potentialSaving,8);assert.equal(report.destinations[0].name,"CI DESTINO VENTAS");
  assert.equal(report.products.length,1);
  const sales=await call("/api/analytics/ventas/laboratorios/analisis",{...q,parte:"ventas"});
  assert.equal(sales.summary.revenue,24);assert.equal(sales.summary.purchaseAmount,null);
  assert.equal(sales.tariffsAvailable,false);
  const saving=await call("/api/analytics/ventas/laboratorios/analisis",{...q,parte:"ahorro"});
  assert.equal(saving.summary.potentialSaving,8);
  // Cierre completo de septiembre + ventas documentales de octubre. El
  // cierre reemplaza el mes entero, pero nunca un rango parcial.
  await db.query("INSERT INTO farmetrica.ventas_panorama_mensual(cliente_slug,farmacia_id,mes,dimension,clave,importe,unidades,lineas) VALUES('ampedia',1,'2026-09-01','articulo','CI-LAB-V-ERP',100,20,1)");
  await db.query("INSERT INTO farmetrica.ventas_panorama_meses_cerrados(cliente_slug,farmacia_id,mes) VALUES('ampedia',1,'2026-09-01') ON CONFLICT DO NOTHING");
  const closed=await call("/api/analytics/ventas/laboratorios/analisis",{...q,desde:"2026-09-01",parte:"ventas"});
  assert.equal(closed.summary.salesUnits,28);assert.equal(closed.summary.revenue,124);
  const partial=await call("/api/analytics/ventas/laboratorios/analisis",{...q,desde:"2026-09-15",parte:"ventas"});
  assert.equal(partial.summary.salesUnits,8);assert.equal(partial.summary.revenue,24);
 }finally{await db.query("ROLLBACK").catch(()=>{});await db.end()}
});
