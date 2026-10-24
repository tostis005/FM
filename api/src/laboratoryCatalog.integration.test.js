import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {readLaboratoryArticles,listLaboratoryOptions} from "./laboratoryCatalog.js";
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
 }finally{await db.query("ROLLBACK").catch(()=>{});await db.end()}
});
