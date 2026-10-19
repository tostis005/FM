import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {loadCommercialNames,nameCommercialRows} from "./commercialNames.js";

test("PostgreSQL real: catálogo vendedor/proveedor local a farmacia, con tenant aislado",{
 skip:!process.env.TEST_DB_URL
},async()=>{
 const db=new pg.Client({connectionString:process.env.TEST_DB_URL});
 await db.connect();
 try{
  await db.query("BEGIN");
  await db.query("CREATE SCHEMA names_ci");
  await db.query("INSERT INTO farmetrica.clientes(slug,nombre,esquema_datos) VALUES('names_ci','Nombres CI','names_ci')");
  const {rows:pharmacies}=await db.query(`
   INSERT INTO farmetrica.farmacias(cliente_slug,nombre,codigo_origen)
    VALUES('names_ci','Farmacia A','F1'),('names_ci','Farmacia B','F2')
    RETURNING id,codigo_origen`);
  const idA=pharmacies.find(x=>x.codigo_origen==="F1").id,
   idB=pharmacies.find(x=>x.codigo_origen==="F2").id;
  await db.query(`CREATE TABLE names_ci.proveedores(
    farmacia_codigo text,origen_id text,nombre text,sincronizado_en timestamptz)`);
  await db.query(`CREATE TABLE names_ci.vendedores(
    farmacia_codigo text,origen_id text,nombre text,sincronizado_en timestamptz)`);
  await db.query(`INSERT INTO names_ci.proveedores VALUES
    ('F1','12','Cooperativa A',now()),
    ('F2','12','Distribuidora B',now()),
    ('F1','55','',now())`);
  await db.query(`INSERT INTO names_ci.vendedores VALUES
    ('F1','3','Marga',now()),('F2','3','Clara',now())`);
  await db.query(`INSERT INTO farmetrica.proveedores_maestro(cliente_slug,codigo_origen,nombre)
    VALUES('names_ci','55','Proveedor configurado')`);
  const context={client:{schema:"names_ci",slug:"names_ci"},
   allowedPharmacyIds:[idA,idB],pharmacies:pharmacies.map(x=>({id:x.id}))};
  const rows=await nameCommercialRows(db,context,[
   {pharmacyId:String(idA),supplierCode:"12",sellerId:"3"},
   {pharmacyId:String(idB),supplierCode:"12",sellerId:"3"},
   {pharmacyId:String(idA),supplierCode:"55",sellerId:"99"}
  ]);
  assert.equal(rows[0].supplierName,"Cooperativa A");
  assert.equal(rows[0].sellerName,"Marga");
  assert.equal(rows[1].supplierName,"Distribuidora B");
  assert.equal(rows[1].sellerName,"Clara");
  assert.equal(rows[2].supplierName,"Proveedor configurado");
  assert.equal(rows[2].sellerName,"99");
  const external=await loadCommercialNames(db,{...context,allowedPharmacyIds:[idA]},[
   {pharmacyId:idA,supplierCode:"12",sellerId:"3"},
   {pharmacyId:idB,supplierCode:"12",sellerId:"3"}
  ]);
  assert.equal(external.supplier(idA,"12"),"Cooperativa A");
  assert.equal(external.seller(idB,"3"),"3","no recuperar vendedores de otra farmacia");
  const {rows:own}=await db.query(`SELECT count(*)::int total FROM names_ci.vendedores`);
  assert.equal(own[0].total,2,"la resolución no altera la fuente");
 }finally{
  await db.query("ROLLBACK").catch(()=>{});
  await db.end();
 }
});
