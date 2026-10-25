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

test("PostgreSQL: dos proveedores equivalentes se fusionan y los ocultos/cooperativas desaparecen",{
 skip:!process.env.TEST_DB_URL
},async()=>{
 const db=new pg.Client({connectionString:process.env.TEST_DB_URL});await db.connect();
 try{
  await db.query("BEGIN");
  const labels=[
   ["CI-ACT-MERGE-1","LABORATORIO QA UNIFICADO","001201"],
   ["CI-ACT-MERGE-2","QA ALTERNO, S.A.","001202"],
   ["CI-ACT-HIDDEN","QA NO MOSTRAR S.L.","001203"],
   ["CI-ACT-COOP","QA DISTRIBUIDOR S.A.","001204"]
  ];
  for(const [id,lab,cn] of labels){
   await db.query(`INSERT INTO ampedia.articulos
    (farmacia_codigo,origen_id,nombre,codigo_nacional,laboratorio,stock_actual)
    VALUES('ABA',$1,$2,$3,$4,1)`,[id,"CI prueba "+id,cn,lab]);
  }
  for(const [code,name,key,cooperative,ignoreReports] of [
   ["CI-PR-UNIFICADO","LABORATORIO QA UNIFICADO","N:QA UNIFICADO",false,false],
   ["CI-PR-ALTERNO","QA ALTERNO, S.A.","N:QA UNIFICADO",false,false],
   ["CI-PR-HIDDEN","QA NO MOSTRAR S.L.",null,false,true],
   ["CI-PR-COOP","QA DISTRIBUIDOR S.A.",null,true,false]
  ]){
   await db.query(`INSERT INTO farmetrica.proveedores_maestro
    (cliente_slug,codigo_origen,nombre,laboratorio_clave,cooperativa,ignorar_informes)
    VALUES('ampedia',$1,$2,$3,$4,$5)
    ON CONFLICT(cliente_slug,codigo_origen) DO UPDATE SET
     nombre=EXCLUDED.nombre,laboratorio_clave=EXCLUDED.laboratorio_clave,
     cooperativa=EXCLUDED.cooperativa,ignorar_informes=EXCLUDED.ignorar_informes`,
    [code,name,key,cooperative,ignoreReports]);
  }
  const ctx={client:{slug:"ampedia",schema:"ampedia"},pharmacies:[{id:1}]};
  const grouped=await listOperationalLaboratoryOptions(db,ctx,[1]);
  const matches=grouped.filter(l=>l.key==="N:QA UNIFICADO");
  assert.equal(matches.length,1,"Los dos laboratorios agrupados aparecen una sola vez");
  assert.equal(matches[0].hasParapharmacy,true);
  assert.ok(!grouped.some(l=>l.key==="N:QA ALTERNO"),
   "No mostrar el nombre antiguo del proveedor enlazado");
  assert.ok(!grouped.some(l=>["N:QA NO MOSTRAR","N:QA DISTRIBUIDOR"].includes(l.key)),
   "Los marcados como ocultos o cooperativas no pueden aparecer por CN");
 }finally{await db.query("ROLLBACK").catch(()=>{});await db.end()}
});
