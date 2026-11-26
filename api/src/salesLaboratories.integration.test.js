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
  await db.query("ALTER TABLE ampedia.articulos ADD COLUMN IF NOT EXISTS ean text");
  await db.query("INSERT INTO farmetrica.nomenclator_presentaciones (cn,nombre,dcpf,generico,laboratorio_comercializador) VALUES ('791921','Producto de prueba','CI-LAB-VENTAS',true,'CI LAB VENTAS'),('791922','Alternativa de prueba','CI-LAB-VENTAS',true,'CI DESTINO VENTAS') ON CONFLICT(cn) DO UPDATE SET nombre=excluded.nombre,dcpf=excluded.dcpf,generico=true,laboratorio_comercializador=excluded.laboratorio_comercializador");
  await db.query("INSERT INTO ampedia.articulos(farmacia_codigo,origen_id,nombre,codigo_nacional,laboratorio,stock_actual) VALUES('ABA','CI-LAB-V-ERP','Producto de prueba','791921','CI LAB VENTAS',10)");
  await db.query("INSERT INTO ampedia.fm_ventas_cabeceras(farmacia_codigo,sistema_origen,documento_id,fecha,lineas_completas) VALUES('ABA','farmatic','CI-LAB-V-SALE','2026-10-21',true)");
  await db.query("INSERT INTO ampedia.fm_ventas_lineas(farmacia_codigo,sistema_origen,documento_id,linea_id,articulo_origen_id,cantidad,importe_neto,devuelta) VALUES('ABA','farmatic','CI-LAB-V-SALE','1','CI-LAB-V-ERP',10,30,false),('ABA','farmatic','CI-LAB-V-SALE','2','CI-LAB-V-ERP',2,6,true)");
  const supplier=(await db.query("INSERT INTO farmetrica.proveedores_unificados(cliente_slug,clave_unificada,nombre,clase) VALUES('ampedia','CI-LAB-V-DIRECT','CI LAB VENTAS','DIRECTO') RETURNING id")).rows[0].id;
  await db.query("INSERT INTO farmetrica.proveedores_unificados_alias(cliente_slug,proveedor_id,farmacia_codigo,codigo_origen) VALUES('ampedia',$1,'ABA','000987654321'),('ampedia',$1,'ABA','0987654321')",[supplier]);
  await db.query("INSERT INTO ampedia.fm_recepciones_cabeceras(farmacia_codigo,sistema_origen,documento_id,fecha,lineas_completas,proveedor_origen_id) VALUES('ABA','farmatic','CI-LAB-V-BUY','2026-10-21',true,'987654321')");
  await db.query("INSERT INTO ampedia.fm_recepciones_lineas(farmacia_codigo,sistema_origen,documento_id,linea_id,articulo_origen_id,cantidad,coste_neto) VALUES('ABA','farmatic','CI-LAB-V-BUY','1','CI-LAB-V-ERP',9,18)");
  await db.query("INSERT INTO farmetrica.genericos_ofertas_laboratorios(cliente_slug,laboratorio_fuente,cn,pvl,descuento,neto,iva,puc,archivo_nombre,importado_por) VALUES('ampedia','CI LAB VENTAS','791921',4,.5,2,.04,2.08,'CI','CI'),('ampedia','CI DESTINO VENTAS','791922',4,.75,1,.04,1.04,'CI','CI')");
  // Marca sin tarifa y parafarmacia con laboratorio solamente en ERP.
  await db.query("INSERT INTO farmetrica.nomenclator_presentaciones(cn,nombre,dcpf,generico,laboratorio_comercializador) VALUES('791923','Marca CI','CI-MARCA',false,'CI LAB VENTAS'),('791924','Parafarmacia CI','CI-PARA',false,NULL) ON CONFLICT(cn) DO UPDATE SET nombre=excluded.nombre,generico=false,laboratorio_comercializador=excluded.laboratorio_comercializador,laboratorio_titular=NULL,laboratorio=NULL");
  await db.query("INSERT INTO ampedia.articulos(farmacia_codigo,origen_id,nombre,codigo_nacional,laboratorio,stock_actual) VALUES('ABA','CI-LAB-V-BRAND','Marca CI','791923','CI LAB VENTAS',10),('ABA','CI-LAB-V-PARA','Parafarmacia CI','791924','CI LAB VENTAS',10),('ABA','CI-LAB-V-COS','Cosmética sin CN',NULL,'CI LAB VENTAS',10)");
  await db.query("INSERT INTO ampedia.fm_ventas_lineas(farmacia_codigo,sistema_origen,documento_id,linea_id,articulo_origen_id,cantidad,importe_neto) VALUES('ABA','farmatic','CI-LAB-V-SALE','3','CI-LAB-V-BRAND',5,50),('ABA','farmatic','CI-LAB-V-SALE','4','CI-LAB-V-PARA',3,45),('ABA','farmatic','CI-LAB-V-SALE','5','CI-LAB-V-COS',2,20)");
  await db.query("INSERT INTO ampedia.fm_recepciones_lineas(farmacia_codigo,sistema_origen,documento_id,linea_id,articulo_origen_id,cantidad,coste_neto) VALUES('ABA','farmatic','CI-LAB-V-BUY','2','CI-LAB-V-BRAND',4,32),('ABA','farmatic','CI-LAB-V-BUY','3','CI-LAB-V-PARA',6,36),('ABA','farmatic','CI-LAB-V-BUY','4','CI-LAB-V-COS',3,15)");
  // Producto comprado al proveedor directo, sin ninguna etiqueta de laboratorio.
  await db.query("INSERT INTO ampedia.articulos(farmacia_codigo,origen_id,nombre,codigo_nacional,laboratorio,stock_actual) VALUES('ABA','CI-LAB-V-UNLINKED','Producto sin etiqueta',NULL,NULL,10)");
  await db.query("INSERT INTO ampedia.fm_ventas_lineas(farmacia_codigo,sistema_origen,documento_id,linea_id,articulo_origen_id,cantidad,importe_neto) VALUES('ABA','farmatic','CI-LAB-V-SALE','6','CI-LAB-V-UNLINKED',4,40)");
  await db.query("INSERT INTO ampedia.fm_recepciones_lineas(farmacia_codigo,sistema_origen,documento_id,linea_id,articulo_origen_id,cantidad,coste_neto) VALUES('ABA','farmatic','CI-LAB-V-BUY','5','CI-LAB-V-UNLINKED',5,25)");
  await db.query("INSERT INTO ampedia.articulos(farmacia_codigo,origen_id,nombre,codigo_nacional,laboratorio,stock_actual) VALUES('ABA','CI-LAB-V-FOREIGN','Producto de otro laboratorio','791922','CI LAB VENTAS',10),('ABA','791921','ERP numérico sin CN',NULL,NULL,10)");
  await db.query("INSERT INTO ampedia.fm_ventas_lineas(farmacia_codigo,sistema_origen,documento_id,linea_id,articulo_origen_id,cantidad,importe_neto) VALUES('ABA','farmatic','CI-LAB-V-SALE','7','CI-LAB-V-FOREIGN',10,100),('ABA','farmatic','CI-LAB-V-SALE','8','791921',3,30)");
  await db.query("INSERT INTO ampedia.fm_recepciones_lineas(farmacia_codigo,sistema_origen,documento_id,linea_id,articulo_origen_id,cantidad,coste_neto) VALUES('ABA','farmatic','CI-LAB-V-BUY','6','CI-LAB-V-FOREIGN',8,80),('ABA','farmatic','CI-LAB-V-BUY','7','791921',2,20)");
  await db.query("INSERT INTO farmetrica.articulos_laboratorio_maestro(codigo,nombre,tipo,laboratorio_clave,laboratorio_nombre) VALUES('8430000012345','Cosmético maestro','parafarmacia','N:CI LAB VENTAS','CI LAB VENTAS')");
  await db.query("INSERT INTO ampedia.articulos(farmacia_codigo,origen_id,nombre,codigo_nacional,ean,laboratorio,stock_actual) VALUES('ABA','CI-LAB-V-EAN','Cosmético maestro',NULL,'8430000012345',NULL,10)");
  await db.query("INSERT INTO ampedia.fm_ventas_lineas(farmacia_codigo,sistema_origen,documento_id,linea_id,articulo_origen_id,cantidad,importe_neto) VALUES('ABA','farmatic','CI-LAB-V-SALE','9','CI-LAB-V-EAN',2,18)");
  await db.query("INSERT INTO ampedia.fm_recepciones_lineas(farmacia_codigo,sistema_origen,documento_id,linea_id,articulo_origen_id,cantidad,coste_neto) VALUES('ABA','farmatic','CI-LAB-V-BUY','8','CI-LAB-V-EAN',3,15)");
  // Laboratorio de parafarmacia exclusivamente, enlazado mediante EAN.
  await db.query("INSERT INTO farmetrica.articulos_laboratorio_maestro(codigo,nombre,tipo,laboratorio_clave,laboratorio_nombre) VALUES('8430000012346','Cosmético exclusivo','parafarmacia','N:CI COSMETICA','CI COSMETICA')");
  await db.query("INSERT INTO ampedia.articulos(farmacia_codigo,origen_id,nombre,codigo_nacional,ean,laboratorio,stock_actual) VALUES('ABA','CI-LAB-V-PURE','Cosmético exclusivo',NULL,'8430000012346',NULL,10)");
  await db.query("INSERT INTO ampedia.fm_ventas_lineas(farmacia_codigo,sistema_origen,documento_id,linea_id,articulo_origen_id,cantidad,importe_neto) VALUES('ABA','farmatic','CI-LAB-V-SALE','10','CI-LAB-V-PURE',7,70)");
  const routes=new Map();
  setupSalesLaboratories({get:(p,...h)=>routes.set(p,h.at(-1))},db,{requireTenantModule:()=>[]});
  const context={role:"gestor",client:{slug:"ampedia",schema:"ampedia"},allowedPharmacyIds:[1],modules:{ventas:true,compras:true,genericos:true},sections:{ventas:true,compras:true,genericos:true}};
  async function call(path,query){
   const res={code:200,status(c){this.code=c;return this},json(body){this.body=body;return this}};
   await routes.get(path)({context,query},res,e=>{throw e});assert.equal(res.code,200);return res.body;
  }
  const options=await call("/api/analytics/ventas/laboratorios",{farmacias:"1",modo:"identidad"});
  assert.ok(options.items.some(x=>x.key==="CI LAB VENTAS"));
  const q={laboratorio:"CI LAB VENTAS",farmacias:"1",desde:"2026-10-21",hasta:"2026-10-21"};
  const report=await call("/api/analytics/ventas/laboratorios/analisis",q);
  assert.equal(report.warnings.length,1);
  assert.equal(report.summary.salesUnits,20);assert.equal(report.summary.revenue,157);
  assert.equal(report.summary.purchaseUnits,25);assert.equal(report.summary.purchaseAmount,116);
  assert.equal(report.summary.directUnits,40);assert.equal(report.summary.directAmount,241);
  assert.equal(report.summary.potentialSaving,8);assert.equal(report.destinations[0].name,"CI DESTINO VENTAS");
  assert.equal(report.products.length,5);
  assert.equal(report.summary.comparableProducts,1);
  assert.ok(report.products.some(p=>p.reference==="ERP:ABA:CI-LAB-V-EAN"));
  assert.equal(report.summary.directUnattributedAmount,125);
  assert.equal(report.summary.directUnattributedUnits,15);
  assert.equal(report.summary.directUnattributedReferences,3);
  assert.ok(!report.products.some(p=>p.cn==="791922"||p.reference==="ERP:ABA:CI-LAB-V-UNLINKED"||p.reference==="ERP:ABA:791921"));
  assert.equal(report.products.find(p=>p.cn==="791924").saving,null);
  assert.ok(report.products.some(p=>p.reference==="ERP:ABA:CI-LAB-V-COS"));
  const pure=await call("/api/analytics/ventas/laboratorios/analisis",{...q,laboratorio:"CI COSMETICA"});
  assert.equal(pure.summary.salesUnits,7);
  assert.equal(pure.summary.revenue,70);
  assert.equal(pure.summary.genericSoldProducts,0);
  assert.equal(pure.summary.potentialSaving,null);
  assert.equal(pure.products.length,1);
  assert.ok(options.items.some(x=>x.key==="CI COSMETICA"));
  const sharedRoutes=new Map(),key="P:"+supplier;
  setupSalesLaboratories({get:(p,...h)=>sharedRoutes.set(p,h.at(-1))},db,{requireTenantModule:()=>[],plannerList:async()=>[{key,name:"CI LAB VENTAS"}],plannerCatalogue:async(_p,_c,o)=>({rows:o.type==="medicacion"?[{referencia:"791921",cn:"791921",nombre:"Genérico"}]:[{referencia:"791924",cn:"791924",nombre:"Parafarmacia"},{referencia:"ERP:1:CI-LAB-V-COS",cn:null,nombre:"Cosmética"}]})});
  const sharedRes={code:200,status(c){this.code=c;return this},json(body){this.body=body;return this}};
  await sharedRoutes.get("/api/analytics/ventas/laboratorios/analisis")({context,query:{...q,laboratorio:key,parte:"ventas"}},sharedRes,e=>{throw e});
  assert.equal(sharedRes.code,200);assert.equal(sharedRes.body.plannerCatalogue,true);
  // Same catalogue CN fallback as Genéricos: the explicit CN takes precedence,
  // but a catalogue CN matching the Farmatic article ID is also usable.
  assert.equal(sharedRes.body.summary.salesUnits,37);assert.equal(sharedRes.body.summary.revenue,327);
  assert.ok(sharedRes.body.products.some(p=>p.cn==="791924"));
  await sharedRoutes.get("/api/analytics/ventas/laboratorios/analisis")({context,query:{...q,laboratorio:key,parte:"todo"}},sharedRes,e=>{throw e});
  assert.equal(sharedRes.body.summary.purchaseAmount,241);
  assert.equal(sharedRes.body.summary.directAmount,241);
  assert.equal(sharedRes.body.summary.directUnattributedAmount,0);
  assert.equal(sharedRes.body.summary.potentialSaving,11);
  assert.equal(sharedRes.body.summary.originTariffProducts,2);
  assert.equal(sharedRes.body.summary.alternativeTariffProducts,1);
  // Familias reales del maestro y EAN ERP, dentro del catálogo seleccionado.
  const family=(await db.query("INSERT INTO farmetrica.familias_globales(cliente_slug,clave,nombre) VALUES('ampedia','CI-LAB-V-FAM','CI Familia laboratorio') RETURNING id")).rows[0].id;
  await db.query("INSERT INTO farmetrica.familias_globales_articulos(cliente_slug,farmacia_codigo,articulo_origen_id,familia_id,metodo) VALUES('ampedia','ABA','CI-LAB-V-ERP',$1,'familia_local') ON CONFLICT(cliente_slug,farmacia_codigo,articulo_origen_id) DO UPDATE SET familia_id=excluded.familia_id",[family]);
  // Use a new setup so the identity cache sees the new family mapping.
  setupSalesLaboratories({get:(p,...h)=>routes.set(p,h.at(-1))},db,{requireTenantModule:()=>[]});
  const familyOptions=await call("/api/analytics/ventas/laboratorios/analisis",{...q,parte:"familias"});
  assert.ok(familyOptions.families.some(f=>f.key===String(family)&&f.name==="CI Familia laboratorio"));
  const filtered=await call("/api/analytics/ventas/laboratorios/analisis",{...q,familias:String(family),articulos:"791921;crema inexistente"});
  assert.equal(filtered.summary.salesUnits,8);assert.equal(filtered.summary.revenue,24);
  assert.equal(filtered.summary.purchaseAmount,18);assert.equal(filtered.summary.directAmount,18);
  assert.equal(filtered.summary.potentialSaving,8);
  assert.deepEqual(filtered.familySales,[{key:String(family),name:"CI Familia laboratorio",units:8,revenue:24}]);
  const ean=await call("/api/analytics/ventas/laboratorios/analisis",{...q,articulos:"8430000012345"});
  assert.equal(ean.summary.revenue,18);assert.equal(ean.summary.directAmount,15);
  assert.equal(ean.catalogueMatches.length,1);
  assert.deepEqual(ean.catalogueMatches[0].eans,["8430000012345"]);
  const excluded=await call("/api/analytics/ventas/laboratorios/analisis",{...q,articulos:"791922"});
  assert.equal(excluded.summary.revenue,0);assert.equal(excluded.summary.directAmount,0);
  assert.deepEqual(excluded.catalogueMatches,[]);
  const sales=await call("/api/analytics/ventas/laboratorios/analisis",{...q,parte:"ventas"});
  assert.equal(sales.summary.revenue,157);assert.equal(sales.summary.purchaseAmount,null);
  assert.equal(sales.tariffsAvailable,false);
  const saving=await call("/api/analytics/ventas/laboratorios/analisis",{...q,parte:"ahorro"});
  assert.equal(saving.summary.potentialSaving,8);
  // Cierre completo de septiembre + ventas documentales de octubre. El
  // cierre reemplaza el mes entero, pero nunca un rango parcial.
  await db.query("INSERT INTO farmetrica.ventas_panorama_mensual(cliente_slug,farmacia_id,mes,dimension,clave,importe,unidades,lineas) VALUES('ampedia',1,'2026-09-01','articulo','CI-LAB-V-ERP',100,20,1)");
  await db.query("INSERT INTO farmetrica.ventas_panorama_meses_cerrados(cliente_slug,farmacia_id,mes) VALUES('ampedia',1,'2026-09-01') ON CONFLICT DO NOTHING");
  const closed=await call("/api/analytics/ventas/laboratorios/analisis",{...q,desde:"2026-09-01",parte:"ventas"});
  assert.equal(closed.summary.salesUnits,40);assert.equal(closed.summary.revenue,257);
  const partial=await call("/api/analytics/ventas/laboratorios/analisis",{...q,desde:"2026-09-15",parte:"ventas"});
  assert.equal(partial.summary.salesUnits,20);assert.equal(partial.summary.revenue,157);
  // WAO: los códigos históricos AMP y ALMACEN son un solo establecimiento.
  const warehouse=(await db.query("SELECT id,nombre_informe_laboratorios AS name FROM farmetrica.farmacias WHERE cliente_slug='ampedia' AND codigo_origen='ALMACEN'")).rows[0];
  assert.equal(warehouse.name,"WAO");
  context.warehouses=[{id:String(warehouse.id),active:true}];
  for(const [code,quantity,amount] of [["AMP",2,12],["ALMACEN",3,18]]){
   await db.query("INSERT INTO ampedia.articulos(farmacia_codigo,origen_id,nombre,codigo_nacional,laboratorio,stock_actual) VALUES($1,'CI-LAB-V-WAO','Producto WAO','791921','CI LAB VENTAS',10)",[code]);
   await db.query("INSERT INTO ampedia.fm_ventas_cabeceras(farmacia_codigo,sistema_origen,documento_id,fecha,lineas_completas) VALUES($1,'farmatic','CI-LAB-V-WAO-SALE','2026-10-21',true)",[code]);
   await db.query("INSERT INTO ampedia.fm_ventas_lineas(farmacia_codigo,sistema_origen,documento_id,linea_id,articulo_origen_id,cantidad,importe_neto) VALUES($1,'farmatic','CI-LAB-V-WAO-SALE','1','CI-LAB-V-WAO',$2,$3)",[code,quantity,amount]);
   await db.query("INSERT INTO farmetrica.proveedores_unificados_alias(cliente_slug,proveedor_id,farmacia_codigo,codigo_origen) VALUES('ampedia',$1,$2,'987654321')",[supplier,code]);
   await db.query("INSERT INTO ampedia.fm_recepciones_cabeceras(farmacia_codigo,sistema_origen,documento_id,fecha,lineas_completas,proveedor_origen_id) VALUES($1,'farmatic','CI-LAB-V-WAO-BUY','2026-10-21',true,'987654321')",[code]);
   await db.query("INSERT INTO ampedia.fm_recepciones_lineas(farmacia_codigo,sistema_origen,documento_id,linea_id,articulo_origen_id,cantidad,coste_neto) VALUES($1,'farmatic','CI-LAB-V-WAO-BUY','1','CI-LAB-V-WAO',$2,$3)",[code,quantity,amount]);
  }
  setupSalesLaboratories({get:(p,...h)=>routes.set(p,h.at(-1))},db,{requireTenantModule:()=>[]});
  const group=await call("/api/analytics/ventas/laboratorios/analisis",{...q,farmacias:"1,"+warehouse.id});
  assert.equal(group.summary.revenue,187);
  assert.equal(group.summary.purchaseAmount,146);
  assert.equal(group.summary.directAmount,271);
  assert.deepEqual(group.siteSales.find(x=>x.id===String(warehouse.id)),{id:String(warehouse.id),units:5,amount:30});
  assert.deepEqual(group.sitePurchases.find(x=>x.id===String(warehouse.id)),{id:String(warehouse.id),units:5,amount:30});
  assert.deepEqual(group.siteDirect.find(x=>x.id===String(warehouse.id)),{id:String(warehouse.id),units:5,amount:30});
  const wao=await call("/api/analytics/ventas/laboratorios/analisis",{...q,farmacias:String(warehouse.id)});
  assert.equal(wao.summary.revenue,30);assert.equal(wao.summary.purchaseAmount,30);assert.equal(wao.summary.directAmount,30);
  const onlyPharmacy=await call("/api/analytics/ventas/laboratorios/analisis",q);
  assert.equal(onlyPharmacy.summary.revenue,157);
 }finally{await db.query("ROLLBACK").catch(()=>{});await db.end()}
});
