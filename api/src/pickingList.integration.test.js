import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {readPickingReport} from "./pickingList.js";

test("PG real: Picking List cruza Shopify con artículos y respeta la farmacia autorizada",{
 skip:!process.env.TEST_DB_URL
},async()=>{
 const pool=new pg.Pool({connectionString:process.env.TEST_DB_URL});
 try{
  const hasArticles=await pool.query("SELECT to_regclass('ampedia.articulos') AS rel");
  assert.ok(hasArticles.rows[0].rel,"Debe existir el catálogo Farmatic");
  // Este test se ejecuta tras el fixture documental del pipeline.
  await pool.query(
   "INSERT INTO farmetrica.picking_list_fuentes(cliente_slug,ultimo_origen,ultima_importacion,ultima_fila) "+
   "VALUES('ampedia','CI',now(),1) "+
   "ON CONFLICT(cliente_slug) "+
   "DO UPDATE SET ultima_importacion=now(),ultima_fila=1,ultimo_origen='CI'");
  await pool.query("DELETE FROM farmetrica.picking_list_pendientes WHERE cliente_slug='ampedia'");
  await pool.query(
   "INSERT INTO farmetrica.picking_list_pendientes "+
   "(cliente_slug,linea,order_id,order_name,quantity,sku,cn,title) "+
   "VALUES ('ampedia',1,'CI-PICK-1','#CI-PICK-1',2,'654321','654321','Artículo de prueba')");
  const report=await readPickingReport(pool,{
   client:{slug:"ampedia",schema:"ampedia"},allowedPharmacyIds:[1,2,3,4,5]
  });
  assert.equal(report.rows.length,1);
  assert.equal(report.rows[0].required,2);
  assert.equal(report.totals.orders,1);
  assert.ok(report.sites.some(s=>s.code==="ABA"));
  assert.ok(report.sites.every(s=>s.code!=="AMP"));
  assert.ok(report.rows[0].stock.some(s=>s.code==="ABA"));
  // No se permite leer las demás farmacias cuando el usuario solo tiene la 1.
  const limited=await readPickingReport(pool,{
   client:{slug:"ampedia",schema:"ampedia"},allowedPharmacyIds:[1]
  });
  assert.ok(limited.sites.filter(s=>s.kind==="farmacia").every(s=>s.id==="1"));
 }finally{
  await pool.query("DELETE FROM farmetrica.picking_list_pendientes WHERE order_id='CI-PICK-1'");
  await pool.end();
 }
});
