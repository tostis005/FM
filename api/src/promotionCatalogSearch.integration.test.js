import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {promotionCatalogSearchSQL,promotionResultCN} from "./promotionCatalogSearch.js";

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
  const {rows:cols}=await db.query(
   "SELECT table_name,column_name FROM information_schema.columns "+
   "WHERE table_schema='ampedia' AND table_name IN ('articulos','proveedores')");
  const sql=promotionCatalogSearchSQL("ampedia",cols);
  const own=[1];
  const nameHits=(await db.query(sql.direct,["ampedia",own,"Farmetrica ZZZ",[],240])).rows;
  assert.equal(nameHits.some(row=>row.source_id==="SIM-ART-123"&&row.pharmacy_id==="1"),true);
  assert.equal(nameHits.every(row=>row.pharmacy_id==="1"),true);
  const cnHits=(await db.query(sql.direct,["ampedia",own,"765432",[],240])).rows;
  const product=cnHits.find(row=>row.source_id==="SIM-ART-123");
  assert.ok(product);
  assert.equal(promotionResultCN(product),"765432");
  const pasted=(await db.query(sql.direct,["ampedia",own,"",["194700"],240])).rows;
  const sevenDigit=pasted.find(row=>row.source_id==="SIM-7-DIGIT-194700");
  assert.ok(sevenDigit,"El CN de seis dígitos debe localizar la ficha ERP con dígito de control");
  assert.equal(promotionResultCN(sevenDigit),"194700");
  const suppliers=(await db.query(sql.suppliers,["ampedia",own,"Buscador Particular",80])).rows;
  assert.ok(suppliers.some(row=>row.supplier_code==="SIMSUP-123"));
  const bySupplier=(await db.query(sql.bySupplier,[
   "ampedia",own,JSON.stringify(suppliers),180
  ])).rows;
  assert.equal(bySupplier.some(row=>row.source_id==="SIM-ART-123"&&
   row.supplier_name==="Laboratorio Buscador Particular"),true);
  assert.equal(bySupplier.every(row=>row.pharmacy_id==="1"),true);
 }finally{
  await db.query("ROLLBACK").catch(()=>{});
  await db.end();
 }
});
