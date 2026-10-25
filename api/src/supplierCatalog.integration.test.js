import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {readDirectLaboratoryCatalog} from "./laboratoryFastCatalog.js";
import {readLaboratoryOrderMatrix} from "./laboratoryOrderPlanner.js";

test("PG: solo recepciones de proveedor vinculado, sin Vademecum extra, y excepción por farmacia",{
 skip:!process.env.TEST_DB_URL
},async()=>{
 const db=new pg.Client({connectionString:process.env.TEST_DB_URL});
 await db.connect();
 try{
  await db.query("BEGIN");
  await db.query(`INSERT INTO farmetrica.articulos_laboratorio_maestro
   (codigo,nombre,tipo,laboratorio_clave,laboratorio_nombre,fuente)
   VALUES('000986','Crema Zimfa de catálogo','parafarmacia','N:ZIMFA','Zimfa','vademecum'),
         ('000987','Crema Zimfa maestra','parafarmacia','N:ZIMFA','Zimfa','vademecum')`);
  await db.query(`INSERT INTO farmetrica.proveedores_maestro
   (cliente_slug,codigo_origen,nombre,laboratorio_clave)
   VALUES('ampedia','PR1','Distribuidor laboratorio QA','N:ZIMFA')
   ON CONFLICT(cliente_slug,codigo_origen) DO UPDATE SET
    laboratorio_clave='N:ZIMFA',cooperativa=false`);
  await db.query("DELETE FROM ampedia.proveedores WHERE farmacia_codigo='ABA' AND origen_id='PR1'");
  await db.query(`INSERT INTO ampedia.proveedores
   (farmacia_codigo,origen_id,nombre)
   VALUES('ABA','PR1','Distribuidor laboratorio QA')`);
  await db.query(`INSERT INTO ampedia.articulos
   (farmacia_codigo,origen_id,nombre,codigo_nacional,laboratorio,stock_actual)
   VALUES('ABA','QA-MAPPED-01','Nombre ERP distinto','000987',NULL,3),
         ('ABA','QA-MAPPED-02','Crema faltante Farmatic','000988',NULL,7)`);
  await db.query(`INSERT INTO ampedia.fm_recepciones_cabeceras
   (farmacia_codigo,sistema_origen,documento_id,fecha,numero_albaran,
    proveedor_origen_id,total_documento,lineas_completas)
   VALUES('ABA','farmatic','QA-MAP-CAB-01','2026-10-17','QA-MAP-01','PR1',10,true)`);
  await db.query(`INSERT INTO ampedia.fm_recepciones_lineas
   (farmacia_codigo,sistema_origen,documento_id,linea_id,articulo_origen_id,cantidad,coste_neto)
   VALUES('ABA','farmatic','QA-MAP-CAB-01','1','QA-MAPPED-01',2,4),
         ('ABA','farmatic','QA-MAP-CAB-01','2','QA-MAPPED-02',3,6)`);
  const ctx={client:{slug:"ampedia",schema:"ampedia"},pharmacies:[{id:1}]};
  const options={key:"N:ZIMFA",pharmacies:[1],type:"parafarmacia",page:1,size:100};
  const result=await readDirectLaboratoryCatalog(db,ctx,options);
  const a=result.rows.find(r=>r.cn==="000986");
  const b=result.rows.find(r=>r.cn==="000987");
  const c=result.rows.find(r=>r.cn==="000988");
  assert.equal(a,undefined,"Vademecum sin ventas o recepciones queda fuera");
  assert.ok(b,"El CN con recepción de Farmatic aparece");
  assert.equal(b.nombre,"Nombre ERP distinto","Se usa la descripción del artículo vendido o recibido");
  assert.equal(result.rows.filter(r=>r.cn==="000987").length,1,"Sin duplicados CN");
  assert.equal(b.inMaster,false);
  assert.equal(b.inReceipts,true);
  assert.equal(c.nombre,"Crema faltante Farmatic","Farmatic añade CN que falta");
  assert.equal(c.inMaster,false);
  const matrix=await readLaboratoryOrderMatrix(db,ctx,{
   ...options,from:"2026-10-01",to:"2026-10-24"});
  const row=matrix.rows.find(r=>r.cn==="000988");
  assert.ok(row,"La matriz presenta también los artículos añadidos desde Farmatic");
  assert.equal(row.byPharmacy["1"].stock,7);

  // Si la farmacia sobrescribe su código de proveedor, prevalece el ajuste.
  await db.query(`INSERT INTO farmetrica.proveedores_laboratorios
   (cliente_slug,farmacia_id,codigo_proveedor,laboratorio_clave)
   VALUES('ampedia',1,'PR1','N:CINFA')
   ON CONFLICT(cliente_slug,farmacia_id,codigo_proveedor) DO UPDATE
    SET laboratorio_clave=EXCLUDED.laboratorio_clave`);
  const overridden=await readDirectLaboratoryCatalog(db,ctx,options);
  assert.equal(overridden.rows.find(r=>r.cn==="000988"),undefined);
  const cinfa=await readDirectLaboratoryCatalog(db,ctx,{
   ...options,key:"N:CINFA"});
  assert.ok(cinfa.rows.some(r=>r.cn==="000988"),"Excepción por farmacia efectiva");
 }finally{await db.query("ROLLBACK").catch(()=>{});await db.end()}
});
