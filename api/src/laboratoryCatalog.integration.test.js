import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {readLaboratoryArticles,listLaboratoryOptions} from "./laboratoryCatalog.js";
import {readLaboratoryOrderMatrix} from "./laboratoryOrderPlanner.js";
import {readDirectLaboratoryCatalog,diagnosticLaboratorySources} from "./laboratoryFastCatalog.js";
test("PostgreSQL real: Zimfa del ERP sin recepciones manuales se presenta una vez",{
 skip:!process.env.TEST_DB_URL
},async()=>{
 const db=new pg.Client({connectionString:process.env.TEST_DB_URL});await db.connect();
 try{
  await db.query("BEGIN");
  await db.query("DELETE FROM ampedia.articulos WHERE farmacia_codigo='ABA' AND origen_id='CI-ARTICLE-ZIMFA'");
  await db.query(`INSERT INTO ampedia.articulos
   (farmacia_codigo,origen_id,nombre,codigo_nacional,laboratorio,stock_actual)
   VALUES('ABA','CI-ARTICLE-ZIMFA','Crema de ensayo Zimfa','000123','Zimfa S.L.',14)`);
  await db.query(`INSERT INTO ampedia.fm_ventas_cabeceras
   (farmacia_codigo,sistema_origen,documento_id,fecha,lineas_completas)
   VALUES('ABA','farmatic','CI-ZIMFA-VENTA','2026-10-21',true) ON CONFLICT DO NOTHING`);
  await db.query(`INSERT INTO ampedia.fm_ventas_lineas
   (farmacia_codigo,sistema_origen,documento_id,linea_id,articulo_origen_id,cantidad,importe_neto)
   VALUES('ABA','farmatic','CI-ZIMFA-VENTA','1','CI-ARTICLE-ZIMFA',1,11) ON CONFLICT DO NOTHING`);
  const context={client:{schema:"ampedia",slug:"ampedia"},pharmacies:[{id:"1"}]};
  const options=await listLaboratoryOptions(db,context);
  assert.equal(options.filter(o=>o.key==="N:ZIMFA").length,1);
  const result=await readLaboratoryArticles(db,context,{
   key:"N:ZIMFA",pharmacies:[1],type:"parafarmacia",search:"ensayo",page:1,size:20
  });
  assert.equal(result.total,1);
  assert.equal(result.rows[0].cn,"000123");
  assert.equal(result.rows[0].nombre,"Crema de ensayo Zimfa");
  assert.equal(result.rows[0].inReceipts,true);
 }finally{await db.query("ROLLBACK").catch(()=>{});await db.end()}
});

test("Cinfa: un único laboratorio AEMPS con titulares/comercializadores y artículos reales en ambas pestañas",{
 skip:!process.env.TEST_DB_URL
},async()=>{
 const db=new pg.Client({connectionString:process.env.TEST_DB_URL});await db.connect();
 try{
  await db.query("BEGIN");
  await db.query(`INSERT INTO farmetrica.nomenclator_presentaciones
   (cn,nombre,dcpf,generico,laboratorio_titular_codigo,laboratorio_titular,
    laboratorio_comercializador_codigo,laboratorio_comercializador)
   VALUES('790321','Medicamento Cinfa A','CI-DCPF',false,'CI-101','Laboratorios Cinfa, S.A.','CI-202','CINFA'),
         ('790322','Medicamento Cinfa B','CI-DCPF',false,'CI-202','CINFA','CI-101','Laboratorios Cinfa SA')
   ON CONFLICT(cn) DO UPDATE SET
    laboratorio_titular=EXCLUDED.laboratorio_titular,
    laboratorio_titular_codigo=EXCLUDED.laboratorio_titular_codigo,
    laboratorio_comercializador=EXCLUDED.laboratorio_comercializador,
    laboratorio_comercializador_codigo=EXCLUDED.laboratorio_comercializador`);
  await db.query("DELETE FROM ampedia.articulos WHERE farmacia_codigo='ABA' AND origen_id='CI-ARTICLE-CINFA'");
  await db.query(`INSERT INTO ampedia.articulos
   (farmacia_codigo,origen_id,nombre,codigo_nacional,laboratorio,stock_actual)
   VALUES('ABA','CI-ARTICLE-CINFA','Crema Cinfa de ensayo','000231','LABORATORIOS CINFA S.A.',8)`);
  await db.query(`INSERT INTO ampedia.fm_ventas_cabeceras
   (farmacia_codigo,sistema_origen,documento_id,fecha,lineas_completas)
   VALUES('ABA','farmatic','CI-CINFA-CREMA-VENTA','2026-10-21',true) ON CONFLICT DO NOTHING`);
  await db.query(`INSERT INTO ampedia.fm_ventas_lineas
   (farmacia_codigo,sistema_origen,documento_id,linea_id,articulo_origen_id,cantidad,importe_neto)
   VALUES('ABA','farmatic','CI-CINFA-CREMA-VENTA','1','CI-ARTICLE-CINFA',1,15) ON CONFLICT DO NOTHING`);
  const ctx={client:{schema:"ampedia",slug:"ampedia"},pharmacies:[{id:1}]};
  const opts=await listLaboratoryOptions(db,ctx);
  assert.equal(opts.filter(o=>o.key==="N:CINFA").length,1);
  const medicine=await readLaboratoryArticles(db,ctx,{key:"N:CINFA",pharmacies:[1],
   type:"medicacion",search:"Cinfa",page:1,size:20});
  assert.equal(medicine.total,2);
  assert.deepEqual(medicine.rows.map(x=>x.cn).sort(),["790321","790322"]);
  const para=await readLaboratoryArticles(db,ctx,{key:"N:CINFA",pharmacies:[1],
   type:"parafarmacia",search:"ensayo",page:1,size:20});
  assert.equal(para.total,1);
  assert.equal(para.rows[0].cn,"000231");
  const medMatrix=await readLaboratoryOrderMatrix(db,ctx,{
   key:"N:CINFA",pharmacies:[1],type:"medicacion",
   from:"2026-10-01",to:"2026-10-24",page:1,size:20,search:"Cinfa"
  });
  assert.equal(medMatrix.rows.length,2);
  assert.ok(medMatrix.rows.every(r=>r.byPharmacy["1"]));
  const paraMatrix=await readLaboratoryOrderMatrix(db,ctx,{
   key:"N:CINFA",pharmacies:[1],type:"parafarmacia",
   from:"2026-10-01",to:"2026-10-24",page:1,size:20,search:"ensayo"
  });
  assert.equal(paraMatrix.rows.length,1);
  assert.equal(paraMatrix.rows[0].byPharmacy["1"].stock,8);
  const directMed=await readDirectLaboratoryCatalog(db,ctx,{
   key:"N:CINFA",pharmacies:[1],type:"medicacion",search:"Cinfa",page:1,size:20});
  assert.equal(directMed.total,2,"Dos presentaciones AEMPS sin depender de movimientos");
  const directPara=await readDirectLaboratoryCatalog(db,ctx,{
   key:"N:CINFA",pharmacies:[1],type:"parafarmacia",search:"ensayo",page:1,size:20});
  assert.equal(directPara.total,1,"Parafarmacia directa del artículo ERP");
  assert.equal(directPara.rows[0].cn,"000231");
  const diagnostic=await diagnosticLaboratorySources(db,ctx,{
   key:"N:CINFA",pharmacies:[1]});
  assert.equal(diagnostic.sources[0].status,"ok");
  assert.ok(diagnostic.sources[0].total>=2);
  assert.ok(diagnostic.sources[1].total>=1);
 }finally{await db.query("ROLLBACK").catch(()=>{});await db.end()}
});

test("PostgreSQL: Cinfa recupera stock y ventas usando origen_id cuando codigo_nacional está vacío",{
 skip:!process.env.TEST_DB_URL
},async()=>{
 const db=new pg.Client({connectionString:process.env.TEST_DB_URL});await db.connect();
 try{
  await db.query("BEGIN");
  await db.query("INSERT INTO farmetrica.nomenclator_presentaciones (cn,nombre,dcpf,generico,laboratorio_titular,laboratorio_comercializador) VALUES ('791234','Cinfa presentación de prueba','QA-CI',false,'Laboratorios Cinfa SA','CINFA') ON CONFLICT(cn) DO UPDATE SET laboratorio_titular='Laboratorios Cinfa SA',laboratorio_comercializador='CINFA'");
  await db.query("DELETE FROM ampedia.articulos WHERE farmacia_codigo='ABA' AND origen_id='791234'");
  await db.query("INSERT INTO ampedia.articulos (farmacia_codigo,origen_id,nombre,codigo_nacional,laboratorio,stock_actual,sincronizado_en) VALUES ('ABA','791234','Medicamento Cinfa de Farmatic',NULL,NULL,17,now())");
  await db.query("INSERT INTO ampedia.fm_ventas_cabeceras (farmacia_codigo,sistema_origen,documento_id,fecha,lineas_completas) VALUES ('ABA','farmatic','CI-CINFA-VENTA-791234','2026-10-21',true) ON CONFLICT DO NOTHING");
  await db.query("INSERT INTO ampedia.fm_ventas_lineas (farmacia_codigo,sistema_origen,documento_id,linea_id,articulo_origen_id,cantidad,importe_neto) VALUES ('ABA','farmatic','CI-CINFA-VENTA-791234','1','791234',4,32) ON CONFLICT DO NOTHING");
  const ctx={client:{schema:"ampedia",slug:"ampedia"},pharmacies:[{id:1}]};
  const opts={key:"N:CINFA",pharmacies:[1],type:"medicacion",search:"791234",page:1,size:20};
  const catalog=await readDirectLaboratoryCatalog(db,ctx,opts);
  assert.equal(catalog.total,1);
  assert.equal(catalog.rows[0].cn,"791234");
  const matrix=await readLaboratoryOrderMatrix(db,ctx,{...opts,from:"2026-10-01",to:"2026-10-24"});
  assert.equal(matrix.total,1);
  assert.equal(matrix.metricsUnavailable,false,"La matriz no debe ocultar métricas verificadas");
  assert.equal(matrix.rows[0].byPharmacy["1"].stock,17);
  assert.equal(matrix.rows[0].byPharmacy["1"].unitsPeriod,4);
  assert.ok(matrix.rows[0].byPharmacy["1"].units12>=4);
 }finally{await db.query("ROLLBACK").catch(()=>{});await db.end()}
});
