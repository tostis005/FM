import {test} from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

test("JOIN documental: cabeceras únicas, importes netos, devoluciones, anulaciones y aislamiento",{
 skip:!process.env.TEST_DB_URL
},async()=>{
 const db=new pg.Client({connectionString:process.env.TEST_DB_URL});
 await db.connect();
 const tenant="doc_ci";
 try{
  await db.query("BEGIN");
  await db.query('CREATE SCHEMA doc_ci');
  await db.query("INSERT INTO farmetrica.clientes(slug,nombre,esquema_datos) VALUES($1,'CI documental',$1)",[tenant]);
  await db.query("SELECT farmetrica.preparar_modelo_documental($1)",[tenant]);
  await db.query("SELECT farmetrica.preparar_vistas_documentales($1)",[tenant]);
  // Dos farmacias pueden usar el mismo documento_id sin colisión.
  await db.query(`INSERT INTO doc_ci.fm_ventas_cabeceras
    (farmacia_codigo,sistema_origen,documento_id,fecha,lineas_completas,
     total_documento,numero_documento,estado) VALUES
    ('ABA','farmatic','V1','2026-10-10',true,15,'T-1','valido'),
    ('EUR','farmatic','V1','2026-10-10',true,6,'T-1','valido'),
    ('ABA','farmatic','PEND','2026-10-10',false,90,'PEND','valido'),
    ('ABA','farmatic','VOID','2026-10-10',true,100,'VOID','anulado')`);
  await db.query(`INSERT INTO doc_ci.fm_ventas_lineas
    (farmacia_codigo,sistema_origen,documento_id,linea_id,articulo_origen_id,cantidad,importe_neto) VALUES
    ('ABA','farmatic','V1','1','A1',2,10),
    ('ABA','farmatic','V1','2','A2',1,5),
    ('EUR','farmatic','V1','1','A1',1,6),
    ('ABA','farmatic','PEND','1','A1',10,90),
    ('ABA','farmatic','VOID','1','A1',10,100)`);
  const sales=await db.query(`SELECT farmacia_codigo,count(*)::int lines,
    sum(unidades)::numeric units,sum(importe)::numeric revenue,
    sum(total_documento)::numeric invalid_header_sum
    FROM doc_ci.fm_ventas_analitica GROUP BY 1 ORDER BY 1`);
  assert.deepEqual(sales.rows.map(x=>[x.farmacia_codigo,x.lines,Number(x.units),Number(x.revenue)]),
    [["ABA",2,3,15],["EUR",1,1,6]]);
  assert.equal(Number(sales.rows[0].invalid_header_sum),30,
    "Las cabeceras se repiten en el JOIN y NUNCA deben sumarse en informes.");
  await db.query(`INSERT INTO doc_ci.fm_recepciones_cabeceras
    (farmacia_codigo,sistema_origen,documento_id,fecha,lineas_completas,proveedor_origen_id,numero_albaran)
    VALUES ('ABA','farmatic','R1','2026-10-10',true,'PR1','ALB-1')`);
  await db.query(`INSERT INTO doc_ci.fm_recepciones_lineas
    (farmacia_codigo,sistema_origen,documento_id,linea_id,articulo_origen_id,cantidad,coste_neto,devuelta)
    VALUES ('ABA','farmatic','R1','1','A1',3,6,false),
           ('ABA','farmatic','R1','2','A2',4,8,false),
           ('ABA','farmatic','R1','3','A3',1,2,true)`);
  const receipts=await db.query(`SELECT count(*)::int lines,
    count(DISTINCT (farmacia_codigo,sistema_origen,documento_id))::int docs,
    sum(unidades)::numeric units,sum(importe)::numeric amount,
    max(coste_unitario)::numeric puc
    FROM doc_ci.fm_recepciones_analitica`);
  assert.equal(receipts.rows[0].lines,3);
  assert.equal(receipts.rows[0].docs,1,"Tres artículos de una cabecera no son tres recepciones.");
  assert.equal(Number(receipts.rows[0].units),6);
  assert.equal(Number(receipts.rows[0].amount),12);
  assert.equal(Number(receipts.rows[0].puc),2);
  // Un UPSERT de las tablas de sincronización se refleja inmediatamente
  // en las vistas sin actualizar materializaciones.
  await db.query(`UPDATE doc_ci.fm_recepciones_lineas SET coste_neto=12
    WHERE farmacia_codigo='ABA' AND documento_id='R1' AND linea_id='1'`);
  const changed=await db.query(`SELECT sum(importe)::numeric AS amount FROM doc_ci.fm_recepciones_analitica`);
  assert.equal(Number(changed.rows[0].amount),18);
  await db.query("SELECT farmetrica.preparar_vistas_documentales($1)",[tenant]);
  const repeated=await db.query("SELECT count(*)::int n FROM doc_ci.fm_ventas_analitica");
  assert.equal(repeated.rows[0].n,3);
 }finally{
  await db.query("ROLLBACK").catch(()=>{});
  await db.end();
 }
});
