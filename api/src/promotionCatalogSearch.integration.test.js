import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {promotionCatalogSearchSQL,promotionSearchPatterns,promotionResultCN} from "./promotionCatalogSearch.js";

test("PostgreSQL: busca nombre, proveedor habitual y CN dentro de la farmacia, sin consultas correlacionadas",{
 skip:!process.env.TEST_DB_URL
},async()=>{
 const db=new pg.Client({connectionString:process.env.TEST_DB_URL});
 await db.connect();
 try{
  await db.query("BEGIN");
  await db.query("ALTER TABLE ampedia.articulos ADD COLUMN IF NOT EXISTS proveedor_habitual_id text");
  await db.query("ALTER TABLE ampedia.articulos ADD COLUMN IF NOT EXISTS cn_normalizado text");
  await db.query("INSERT INTO ampedia.proveedores(farmacia_codigo,origen_id,nombre) "+
   "VALUES('ABA','SIMSUP-123','Laboratorio Buscador Particular'),"+
   "('EUR','SIMSUP-123','Proveedor ajeno') ");
  await db.query("INSERT INTO ampedia.articulos"+
   "(farmacia_codigo,origen_id,nombre,codigo_nacional,cn_normalizado,laboratorio,proveedor_habitual_id) "+
   "VALUES('ABA','SIM-ART-123','Crema buscador Farmetrica ZZZ',NULL,'765432','',"+"'SIMSUP-123'),"+
   "('EUR','SIM-ART-123','Otro producto de otra farmacia',NULL,'654321','','SIMSUP-123')");
  await db.query("INSERT INTO ampedia.articulos(farmacia_codigo,origen_id,nombre,codigo_nacional,laboratorio) "+
   "VALUES('ABA','SIM-7-DIGIT-194700','Artículo CN con dígito de control','1947001','Lab Test')");
  // El mismo código que aparece con nombre en Extracción de ventas debe
  // recuperar su nombre al pegarlo, desde Farmatic, sin consultar fuentes externas.
  await db.query("INSERT INTO ampedia.articulos"+
   "(farmacia_codigo,origen_id,nombre,codigo_nacional,laboratorio,proveedor_habitual_id) "+
   "VALUES('ABA','168766','Eucerin Atopi Control 250 ml',NULL,NULL,NULL)");
  await db.query("INSERT INTO ampedia.fm_recepciones_cabeceras"+
   "(farmacia_codigo,sistema_origen,documento_id,fecha,proveedor_origen_id,lineas_completas) "+
   "VALUES('ABA','farmatic','SIM-EUC-168766','2026-10-20','SIMSUP-123',true)");
  await db.query("INSERT INTO ampedia.fm_recepciones_lineas"+
   "(farmacia_codigo,sistema_origen,documento_id,linea_id,articulo_origen_id,cantidad) "+
   "VALUES('ABA','farmatic','SIM-EUC-168766','1','168766',2)");

  const {rows:cols}=await db.query(
   "SELECT table_name,column_name FROM information_schema.columns "+
   "WHERE table_schema='ampedia' AND table_name IN ('articulos','proveedores')");
  const sql=promotionCatalogSearchSQL("ampedia",cols);
  const own=[1];
  const nameHits=(await db.query(sql.direct,["ampedia",own,promotionSearchPatterns("Farmetrica ZZZ"),[],240,0,"%farmetrica%"])).rows;
  assert.equal(nameHits.some(row=>row.source_id==="SIM-ART-123"&&row.pharmacy_id==="1"),true);
  assert.equal(nameHits.every(row=>row.pharmacy_id==="1"),true);
  const cnHits=(await db.query(sql.direct,["ampedia",own,promotionSearchPatterns("765432"),[],240,0,"%765432%"])).rows;

  // Todas las palabras, en otro orden e incluso repartidas entre columnas.
  const orderFree=(await db.query(sql.direct,[
   "ampedia",own,promotionSearchPatterns("ZZZ Crema"),[],240,0,"%crema%"
  ])).rows;
  assert.ok(orderFree.some(row=>row.source_id==="SIM-ART-123"));
  const acrossFields=(await db.query(sql.direct,[
   "ampedia",own,promotionSearchPatterns("765432 Farmetrica"),[],240,0,"%farmetrica%"
  ])).rows;
  assert.ok(acrossFields.some(row=>row.source_id==="SIM-ART-123"));
  // La búsqueda de campañas no debe depender del Nomenclátor.
  assert.equal(sql.officialCatalog,undefined);
  assert.ok(!sql.direct.includes("nomenclator_presentaciones"));
   assert.match(sql.direct,/LIKE \$7::text/);
   assert.match(sql.byCodes,/left\(btrim\(a.codigo_nacional::text\),6\)/);
  const product=cnHits.find(row=>row.source_id==="SIM-ART-123");
  assert.ok(product);
  assert.equal(promotionResultCN(product),"765432");

  const pastedParapharmacy=(await db.query(sql.byCodes,[
   "ampedia",own,[],["168766"],240,0
  ])).rows;
  const eucerin=pastedParapharmacy.find(row=>row.resolved_cn==="168766");
  assert.ok(eucerin,"El CN pegado debe resolver por origen_id de Farmatic");
  assert.equal(eucerin.description,"Eucerin Atopi Control 250 ml");
  assert.equal(eucerin.reference_type,"farmatic");
  const textResults=(await db.query(sql.direct,[
   "ampedia",own,promotionSearchPatterns("Atopi Eucerin"),[],240,0,"%eucerin%"
  ])).rows;
  assert.ok(textResults.some(row=>row.resolved_cn==="168766"),
   "El buscador por palabras debe incluir referencias ERP sin CN rellenado");
  const pasted=(await db.query(sql.byCodes,["ampedia",own,[],["194700"],240,0])).rows;
  const sevenDigit=pasted.find(row=>row.source_id==="SIM-7-DIGIT-194700");
  assert.ok(sevenDigit,"El CN de seis dígitos debe localizar la ficha ERP con dígito de control");
  assert.equal(promotionResultCN(sevenDigit),"194700");

  // Reproduce el fallo: cientos de filas ERP sin CN intercaladas con
  // más de 200 CN distintos. Ninguna fila sin CN puede ocupar una plaza.
  await db.query("INSERT INTO ampedia.articulos(farmacia_codigo,origen_id,nombre,codigo_nacional) "+
   "SELECT 'ABA','SIM-EMPTY-'||i,'BUSQUEDA-AMPLIA-TEST',NULL "+
   "FROM generate_series(1,330) i");
  await db.query("INSERT INTO ampedia.articulos(farmacia_codigo,origen_id,nombre,codigo_nacional) "+
   "SELECT 'ABA','SIM-CN-'||i,'BUSQUEDA-AMPLIA-TEST',lpad((880000+i)::text,6,'0') "+
   "FROM generate_series(1,235) i");
  await db.query("INSERT INTO ampedia.articulos(farmacia_codigo,origen_id,nombre,codigo_nacional) "+
   "SELECT 'EUR','SIM-REPEAT-'||i,'BUSQUEDA-AMPLIA-TEST',lpad((880000+i)::text,6,'0') "+
   "FROM generate_series(1,140) i");
  const first=(await db.query(sql.direct,["ampedia",[1,2],promotionSearchPatterns("BUSQUEDA-AMPLIA-TEST"),[],180,0,"%busqueda-amplia-test%"])).rows;
  const second=(await db.query(sql.direct,["ampedia",[1,2],promotionSearchPatterns("BUSQUEDA-AMPLIA-TEST"),[],180,180,"%busqueda-amplia-test%"])).rows;
  assert.equal(first.length,180);
  assert.equal(second.length,55);
  const all=[...first,...second];
  assert.equal(new Set(all.map(row=>promotionResultCN(row))).size,235);
  assert.ok(all.every(row=>/^\d{6}$/.test(row.resolved_cn)));
  const suppliers=(await db.query(sql.suppliers,["ampedia",own,promotionSearchPatterns("Buscador Particular"),80])).rows;
  assert.ok(suppliers.some(row=>row.supplier_code==="SIMSUP-123"));

  const supplierMixed=(await db.query(sql.bySupplier,[
   "ampedia",own,JSON.stringify(suppliers),180,0,
   promotionSearchPatterns("Particular Crema")
  ])).rows;
  assert.ok(supplierMixed.some(row=>row.source_id==="SIM-ART-123"));

  const received=(await db.query(sql.byReceiptSupplier,[
   "ampedia",own,JSON.stringify(suppliers),180,0,
   promotionSearchPatterns("Particular Eucerin")
  ])).rows;
  assert.ok(received.some(row=>row.resolved_cn==="168766"&&
    row.description==="Eucerin Atopi Control 250 ml"),
   "La relación proveedor-artículo debe existir por recepciones aunque falte proveedor habitual");
  assert.ok(received.every(row=>row.pharmacy_id==="1"),
   "No relacionar códigos de proveedor de otras farmacias");
  const bySupplier=(await db.query(sql.bySupplier,[
   "ampedia",own,JSON.stringify(suppliers),180,0,promotionSearchPatterns("Buscador Particular")
  ])).rows;
  assert.equal(bySupplier.some(row=>row.source_id==="SIM-ART-123"&&
   row.supplier_name==="Laboratorio Buscador Particular"),true);
  assert.equal(bySupplier.every(row=>row.pharmacy_id==="1"),true);
 }finally{
  await db.query("ROLLBACK").catch(()=>{});
  await db.end();
 }
});
