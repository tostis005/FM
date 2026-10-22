import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {economicOverview,economicPrices,economicStock,readOnly} from "./savingsAnalysis.js";
const enabled=process.env.FM_SAVINGS_PG_TEST==="1"&&Boolean(process.env.DATABASE_URL);
test("SQL económico PostgreSQL: unidades y PUC ponderado, cooperativas, locales, stock y exclusiones",{skip:!enabled},async()=>{
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:2,connectionTimeoutMillis:5000});
 const prep=await pool.connect();
 try{
  await prep.query("DROP SCHEMA IF EXISTS fm_savings_ci CASCADE");
  await prep.query("CREATE SCHEMA IF NOT EXISTS farmetrica");
  await prep.query("CREATE SCHEMA fm_savings_ci");
  await prep.query(`CREATE TABLE IF NOT EXISTS farmetrica.farmacias(id int,cliente_slug text,nombre text,codigo_origen text)`);
  await prep.query(`CREATE TABLE IF NOT EXISTS farmetrica.proveedores_maestro(cliente_slug text,codigo_origen text,nombre text,cooperativa boolean,ignorar_informes boolean)`);
  await prep.query(`CREATE TABLE IF NOT EXISTS farmetrica.op_politicas_reposicion(cliente_slug text,farmacia_id int,cobertura_saludable int)`);
  await prep.query(`CREATE TABLE fm_savings_ci.proveedores(farmacia_codigo text,origen_id text,nombre text)`);
  await prep.query(`CREATE TABLE fm_savings_ci.fm_recepciones_analitica(farmacia_codigo text,articulo_id text,proveedor_id text,proveedor_nombre text,fecha date,unidades numeric,coste_unitario numeric,importe numeric)`);
  await prep.query(`CREATE TABLE fm_savings_ci.fm_ventas_analitica(farmacia_codigo text,articulo_id text,fecha date,unidades numeric,importe numeric)`);
  await prep.query(`CREATE TABLE fm_savings_ci.articulos(farmacia_codigo text,origen_id text,stock_actual numeric,pmc numeric,puc numeric,sincronizado_en timestamptz)`);
  // Cliente de test propio; evita datos operativos de cualquier otra prueba.
  await prep.query(`INSERT INTO farmetrica.farmacias VALUES
    (901,'fm_savings_ci','Farmacia A','ABA'),(902,'fm_savings_ci','Farmacia B','EUR')`);
  await prep.query(`INSERT INTO farmetrica.proveedores_maestro VALUES
    ('fm_savings_ci','0005','COOP A',true,false),
    ('fm_savings_ci','0256','LAB A',false,false),
    ('fm_savings_ci','8000','TRASPASO',false,true)`);
  await prep.query(`INSERT INTO fm_savings_ci.proveedores VALUES
    ('ABA','0005','COOP A'),('ABA','256','LAB A'),('ABA','8000','TRASPASO'),
    ('EUR','0005','LAB X')`);
  await prep.query(`INSERT INTO fm_savings_ci.fm_recepciones_analitica VALUES
    ('ABA','A1','0005',NULL,'2026-10-01',1,12,12),
    ('ABA','A1','0005',NULL,'2026-10-02',1,11,11),
    ('ABA','A1','256',NULL,'2026-10-03',1,9,9),
    ('ABA','A1','256',NULL,'2026-10-04',1,9,9),
    ('ABA','A1','8000',NULL,'2026-10-05',200,5,1000),
    ('EUR','A1','0005',NULL,'2026-10-04',1,14,14)`);
  await prep.query(`INSERT INTO fm_savings_ci.fm_ventas_analitica VALUES
    ('ABA','A1','2026-10-01',3,45),('EUR','A1','2026-10-01',7,70)`);
  await prep.query(`INSERT INTO fm_savings_ci.articulos VALUES
    ('ABA','A1',30,8,9,now()),('ABA','NOSELL',10,2,2,now())`);
  await prep.query(`INSERT INTO farmetrica.op_politicas_reposicion VALUES
    ('fm_savings_ci',901,30)`);
  const scope={from:"2026-09-01",to:"2026-10-21",ids:[901],slug:"fm_savings_ci",schema:'"fm_savings_ci"'};
  const overview=await readOnly(pool,db=>economicOverview(db,scope));
  assert.equal(overview.totals.sales.amount,45);
  assert.equal(overview.totals.purchases.amount,41);
  assert.equal(overview.totals.purchases.channels.cooperativa.amount,23);
  assert.equal(overview.totals.purchases.channels.no_cooperativa.amount,18);
  assert.equal(overview.totals.stock.amount,260);
  const prices=await readOnly(pool,db=>economicPrices(db,scope,10));
  assert.equal(prices.totals.references,1);
  assert.equal(prices.totals.verified,1);
  assert.equal(Number(prices.totals.observed),5);
  const stock=await readOnly(pool,db=>economicStock(db,scope));
  assert.equal(stock.rows[0].withoutSalesValue,20);
  assert.ok(stock.rows[0].excessCapital>200);
  // EUR reutiliza el código 0005 con otro nombre: nunca se compara como cooperativa.
  const other={...scope,ids:[902]};
  const check=await readOnly(pool,db=>economicOverview(db,other));
  assert.equal(check.totals.purchases.channels.sin_verificar.amount,14);
 }finally{
  try{await prep.query("DELETE FROM farmetrica.op_politicas_reposicion WHERE cliente_slug='fm_savings_ci'")}catch{}
  try{await prep.query("DELETE FROM farmetrica.proveedores_maestro WHERE cliente_slug='fm_savings_ci'")}catch{}
  try{await prep.query("DELETE FROM farmetrica.farmacias WHERE cliente_slug='fm_savings_ci'")}catch{}
  try{await prep.query("DROP SCHEMA IF EXISTS fm_savings_ci CASCADE")}catch{}
  prep.release();await pool.end();
 }
});
