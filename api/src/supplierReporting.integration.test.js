import {test} from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {includedPurchaseSupplier} from "./supplierReporting.js";
test("filtro SQL de compras aísla clientes y excluye código o nombre",async()=>{
 if(!process.env.TEST_DB_URL)throw Error("Falta TEST_DB_URL");
 const db=new pg.Client({connectionString:process.env.TEST_DB_URL});
 await db.connect();
 try{
  await db.query("BEGIN");
  // No alterar el maestro de producción ni los datos de prueba de otros casos.
  const {rows:[one]}=await db.query("SELECT slug FROM farmetrica.clientes ORDER BY slug LIMIT 1");
  assert.ok(one?.slug);
  const code="TEST_IGN_"+Date.now(),name="Farmacia interna "+Date.now();
  await db.query(`INSERT INTO farmetrica.proveedores_maestro
   (cliente_slug,codigo_origen,nombre,tipo,ignorar_informes)
   VALUES($1,$2,$3,'otros',true)`,[one.slug,code,name]);
  const sql=`SELECT t.proveedor_id,t.proveedor_nombre FROM
   (VALUES ($1::text,$2::text)) AS t(proveedor_id,proveedor_nombre)
   WHERE ${includedPurchaseSupplier({tenant:"$3",code:"t.proveedor_id",name:"t.proveedor_nombre"})}`;
  const ignoredByCode=await db.query(sql,[code,"Distinto",one.slug]);
  assert.equal(ignoredByCode.rowCount,0);
  const ignoredByName=await db.query(sql,["otro"," "+name.toLowerCase()+" ",one.slug]);
  assert.equal(ignoredByName.rowCount,0);
  const allowed=await db.query(sql,["externo","Proveedor limpio",one.slug]);
  assert.equal(allowed.rowCount,1);
  const {rows:[other]}=await db.query("SELECT slug FROM farmetrica.clientes WHERE slug<>$1 ORDER BY slug LIMIT 1",[one.slug]);
  if(other){
   const otherResult=await db.query(sql,[code,name,other.slug]);
   assert.equal(otherResult.rowCount,1,"las exclusiones no saltan entre clientes");
  }
 }finally{await db.query("ROLLBACK").catch(()=>{});await db.end()}
});
