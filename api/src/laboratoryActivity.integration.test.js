import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {listLaboratoryOptions,listOperationalLaboratoryOptions} from "./laboratoryCatalog.js";

test("PostgreSQL: el preparador omite Nomenclátor sin actividad, pero admite CN y recepciones por farmacia",{
 skip:!process.env.TEST_DB_URL
},async()=>{
 const db=new pg.Client({connectionString:process.env.TEST_DB_URL});
 await db.connect();
 try{
  await db.query("BEGIN");
  const ctx={client:{slug:"ampedia",schema:"ampedia"},pharmacies:[{id:1},{id:2}]};
  await db.query(`INSERT INTO farmetrica.nomenclator_presentaciones
   (cn,nombre,dcpf,generico,laboratorio_titular,laboratorio_comercializador)
   VALUES('797151','Solo ficha oficial sin recepciones','CI-SOLO-CATALOGO',false,
    'LABORATORIO QA SOLO NOMENCLATOR','LABORATORIO QA SOLO NOMENCLATOR')
   ON CONFLICT(cn) DO UPDATE SET
    laboratorio_titular=EXCLUDED.laboratorio_titular,
    laboratorio_comercializador=EXCLUDED.laboratorio_comercializador`);
  await db.query(`INSERT INTO ampedia.articulos
   (farmacia_codigo,origen_id,nombre,codigo_nacional,laboratorio,stock_actual)
   VALUES('ABA','CI-ACTIVO-CN-UNO','Artículo con CN y laboratorio local',
    '001198','LABORATORIOS QA SOLO CN',0)`);
  await db.query(`INSERT INTO ampedia.proveedores(farmacia_codigo,origen_id,nombre)
   VALUES('ABA','CI-QA-REC-PROV','LABORATORIOS QA SOLO RECEPCIONES')`);
  await db.query(`INSERT INTO ampedia.fm_recepciones_cabeceras
   (farmacia_codigo,sistema_origen,documento_id,fecha,proveedor_origen_id,lineas_completas)
   VALUES('ABA','farmatic','CI-ACTIVO-REC-UNO','2026-10-24',
    'CI-QA-REC-PROV',true)`);
  await db.query(`INSERT INTO ampedia.fm_recepciones_lineas
   (farmacia_codigo,sistema_origen,documento_id,linea_id,articulo_origen_id,cantidad,coste_neto)
   VALUES('ABA','farmatic','CI-ACTIVO-REC-UNO','1','CI-SIN-CN-REC',2,10)`);
  const all=await listLaboratoryOptions(db,ctx);
  assert.ok(all.some(l=>l.key==="N:QA SOLO NOMENCLATOR"),
   "El maestro conserva la opción oficial sin actividad");
  const scoped=await listOperationalLaboratoryOptions(db,ctx,[1]);
  assert.ok(!scoped.some(l=>l.key==="N:QA SOLO NOMENCLATOR"),
   "Nomenclátor sin artículo de farmacia ni compra no debe ofrecerse");
  assert.equal(scoped.filter(l=>l.key==="N:QA SOLO CN").length,1,
   "Un artículo ERP con CN cuenta aunque no tenga historial de movimientos");
  assert.ok(scoped.some(l=>l.key==="N:QA SOLO RECEPCIONES"),
   "Una compra directa permite incluir laboratorios fuera del Nomenclátor");
  const otherPharmacy=await listOperationalLaboratoryOptions(db,ctx,[2]);
  assert.ok(!otherPharmacy.some(l=>l.key==="N:QA SOLO CN"),
   "No incorporar actividad de otras farmacias");
  assert.ok(!otherPharmacy.some(l=>l.key==="N:QA SOLO RECEPCIONES"),
   "No incorporar recepciones de otras farmacias");
  assert.deepEqual(await listOperationalLaboratoryOptions(db,ctx,[]),[]);
 }finally{await db.query("ROLLBACK").catch(()=>{});await db.end()}
});
