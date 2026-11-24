import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {warehouseTicketDiscountSQL,completeWarehouseTicketNames} from "./promotionWarehouseExport.js";
import {nameTicketArticleRows} from "./articleNames.js";
import {resolvePromotionArticleKeys} from "./promocionesArticulos.js";

test("PostgreSQL: importe de descuento explícito, recuperado y desconocido sin inventar importes",{
 skip:!process.env.TEST_DB_URL
},async()=>{
 const db=new pg.Client({connectionString:process.env.TEST_DB_URL});await db.connect();
 try{
  const {rows}=await db.query("SELECT v.id,("+warehouseTicketDiscountSQL()+")::float8 AS discount FROM (VALUES (1,'almacen',NULL::numeric,0::numeric,10::numeric,2::numeric,15::numeric),(2,'almacen',0,0,10,2,15),(3,'almacen',NULL,2,10,2,15),(4,'almacen',NULL,0,10,2,20),(5,'almacen',NULL,0,NULL,2,15),(6,'farmacia',NULL,0,10,2,15),(7,'almacen',NULL,0,10,-2,-15),(8,'almacen',NULL,0,10,2,21)) AS v(id,tipo,descuento_linea,descuento_operacion_documento,precio_unitario,unidades,importe) CROSS JOIN LATERAL (SELECT v.tipo AS tipo_establecimiento) f ORDER BY v.id");
  assert.deepEqual(rows.map(r=>r.discount),[5,0,null,0,null,null,5,null]);
 }finally{await db.end()}
});
test("PostgreSQL: resolver artículos ERP y nombre de un almacén autorizado",{
 skip:!process.env.TEST_DB_URL
},async()=>{
 const db=new pg.Client({connectionString:process.env.TEST_DB_URL});await db.connect();
 try{
  await db.query("BEGIN");
  await db.query("CREATE SCHEMA prom_alm_ci");
  await db.query("INSERT INTO farmetrica.clientes(slug,nombre,esquema_datos) VALUES('prom_alm_ci','CI almacén','prom_alm_ci')");
  const {rows:est}=await db.query("INSERT INTO farmetrica.farmacias(cliente_slug,nombre,codigo_origen,tipo_establecimiento) VALUES('prom_alm_ci','CI almacén','ALM','almacen'),('prom_alm_ci','CI farmacia','F1','farmacia') RETURNING id,codigo_origen");
  const warehouse=est.find(x=>x.codigo_origen==="ALM").id,pharmacy=est.find(x=>x.codigo_origen==="F1").id;
  await db.query("CREATE TABLE prom_alm_ci.articulos(farmacia_codigo text,origen_id text,nombre text,codigo_nacional text)");
  await db.query("INSERT INTO prom_alm_ci.articulos VALUES('ALM','ERP-1','Artículo almacén','123456'),('F1','ERP-1','Otro artículo','234567'),('F1','ERP-2','Nombre por CN','345678')");
  const context={client:{slug:"prom_alm_ci",schema:"prom_alm_ci"},allowedPharmacyIds:[warehouse,pharmacy]};
  const cn=["123456","345678"];
  const links=await resolvePromotionArticleKeys(db,context,cn);
  assert.ok(links.some(a=>a.key===warehouse+"|ERP-1"&&a.cn==="123456"));
  const rows=await nameTicketArticleRows(db,context,[{pharmacyId:String(warehouse),cn:"ERP-1"},{pharmacyId:String(warehouse),cn:"345678"},{pharmacyId:String(pharmacy),cn:"ERP-1"}]);
  assert.equal(rows[0].articleName,"Artículo almacén");
  assert.equal(rows[2].articleName,"Otro artículo");
  const completed=await completeWarehouseTicketNames(db,context,rows,{warehouseIds:[warehouse],cns:cn,articleKeys:links});
  assert.equal(completed[1].nationalCode,"345678");
  assert.ok(completed[1].articleName);
  const restricted=await nameTicketArticleRows(db,{...context,allowedPharmacyIds:[pharmacy]},[{pharmacyId:String(warehouse),cn:"ERP-1"}]);
  assert.equal(restricted[0].articleName,null);
 }finally{await db.query("ROLLBACK").catch(()=>{});await db.end()}
});
