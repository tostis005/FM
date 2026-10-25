import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {listLaboratoryOptions} from "./laboratoryCatalog.js";
import {readLocalSuppliers} from "./laboratoryOrderSettings.js";
import {readDirectLaboratoryCatalog} from "./laboratoryFastCatalog.js";

test("PG: identidad propia reúne dos proveedores de farmacias distintas sin AEMPS y conserva las compras",{
 skip:!process.env.TEST_DB_URL
},async()=>{
 const db=new pg.Client({connectionString:process.env.TEST_DB_URL});
 await db.connect();
 try{
  await db.query("BEGIN");
  const key="N:PROVEEDOR PRUEBA UNIFICADO",code="QA-PROP-LAB-26";
  await db.query(`INSERT INTO farmetrica.laboratorios_personalizados
   (cliente_slug,laboratorio_clave,nombre)
   VALUES('ampedia',$1,'Laboratorios Proveedor Prueba Unificado SA')`,[key]);
  await db.query(`INSERT INTO ampedia.proveedores
   (farmacia_codigo,origen_id,nombre)
   VALUES('ABA',$1,'LABORATORIOS PROVEEDOR PRUEBA UNIFICADO S.A.'),
         ('EUR',$1,'Proveedor Prueba Unificado')`,[code]);
  await db.query(`INSERT INTO farmetrica.proveedores_laboratorios
   (cliente_slug,farmacia_id,codigo_proveedor,laboratorio_clave)
   VALUES('ampedia',1,$1,$2),('ampedia',2,$1,$2)`,[code,key]);
  await db.query(`INSERT INTO ampedia.articulos
   (farmacia_codigo,origen_id,nombre,codigo_nacional,laboratorio,stock_actual)
   VALUES('ABA','QA-PROP-ART-26','Crema entidad unificada QA','009926',NULL,3)`);
  await db.query(`INSERT INTO ampedia.fm_recepciones_cabeceras
   (farmacia_codigo,sistema_origen,documento_id,fecha,numero_albaran,
    proveedor_origen_id,total_documento,lineas_completas)
   VALUES('ABA','farmatic','QA-PROP-DOC-26','2026-10-24',
    'QA-PROP-DOC-26',$1,12,true)`,[code]);
  await db.query(`INSERT INTO ampedia.fm_recepciones_lineas
   (farmacia_codigo,sistema_origen,documento_id,linea_id,articulo_origen_id,
    cantidad,coste_neto)
   VALUES('ABA','farmatic','QA-PROP-DOC-26','1','QA-PROP-ART-26',2,12)`);
  const ctx={client:{slug:"ampedia",schema:"ampedia"},pharmacies:[{id:1},{id:2}]};
  const official=await listLaboratoryOptions(db,ctx);
  assert.ok(official.some(x=>x.key===key),"El selector incluye identidades sin AEMPS");
  const local=await readLocalSuppliers(db,ctx);
  const aliases=local.filter(x=>x.sourceCode===code);
  assert.equal(aliases.length,2,"El mismo código ERP no se fusiona entre farmacias");
  assert.deepEqual(aliases.map(x=>x.pharmacyId).sort(),["1","2"]);
  assert.ok(aliases.every(x=>x.laboratoryKey===key));
  assert.notEqual(aliases[0].name,aliases[1].name,
   "Los dos nombres originales permanecen intactos");
  const found=await readDirectLaboratoryCatalog(db,ctx,{
   key,pharmacies:[1,2],type:"parafarmacia",
   search:"Crema entidad unificada QA",page:1,size:20
  });
  assert.equal(found.total,1,"La recepción real aparece bajo identidad propia");
  assert.equal(found.rows[0].inPurchases,true);
 }finally{
  await db.query("ROLLBACK").catch(()=>{});
  await db.end();
 }
});
