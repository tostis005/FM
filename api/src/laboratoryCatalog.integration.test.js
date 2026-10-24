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
