import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import pg from "pg";

test("Migración 016: esquema por cliente, aislado, idempotente y sin borrar históricos", async () => {
  if (!process.env.FM_TEST_DATABASE_URL) throw Error("Definir FM_TEST_DATABASE_URL en integración");
  const db = new pg.Client({connectionString:process.env.FM_TEST_DATABASE_URL});
  await db.connect();
  try {
    await db.query("CREATE SCHEMA farmetrica");
    await db.query("CREATE TABLE farmetrica.clientes (slug text PRIMARY KEY, esquema_datos text NOT NULL)");
    await db.query("CREATE SCHEMA ampedia");
    await db.query("CREATE SCHEMA farmacia_tenant");
    await db.query("CREATE TABLE ampedia.ventas (id integer PRIMARY KEY, importe numeric)");
    await db.query("INSERT INTO ampedia.ventas VALUES (1, 42.25)");
    await db.query("INSERT INTO farmetrica.clientes VALUES ('ampedia','ampedia'),('tenant','farmacia_tenant')");
    const migration = await readFile(new URL("./016_modelo_documental.sql", import.meta.url), "utf8");
    await db.query(migration);
    await db.query(migration); // Repetición sin cambios ni pérdida de datos
    const {rows:[historic]}=await db.query("SELECT count(*)::int n,max(importe)::numeric valor FROM ampedia.ventas");
    assert.equal(historic.n,1);
    assert.equal(Number(historic.valor),42.25);
    for (const schema of ["ampedia","farmacia_tenant"]) {
      const {rows:[names]}=await db.query(
        "SELECT count(*)::int n FROM information_schema.tables WHERE table_schema=$1 AND table_name=ANY($2::text[])",
        [schema,["fm_ventas_cabeceras","fm_ventas_lineas","fm_recepciones_cabeceras",
        "fm_recepciones_lineas","fm_pedidos_cabeceras","fm_pedidos_lineas",
        "fm_stock_fotografia","fm_producto_correspondencias",
        "fm_sync_ejecuciones","fm_sync_rechazos"]]);
      assert.equal(names.n,10, "Faltan entidades de "+schema);
    }
    await assert.rejects(() => db.query(
      "SELECT farmetrica.preparar_modelo_documental('public')"), /no autorizado/);
    await db.query(`INSERT INTO ampedia.fm_ventas_cabeceras
      (farmacia_codigo,sistema_origen,documento_id,fecha,total_documento)
      VALUES ('ABA','farmatic','123','2026-10-19 11:00',15.15),
             ('EUR','farmatic','123','2026-10-19 11:00',29.10)`);
    await db.query(`INSERT INTO ampedia.fm_ventas_lineas
      (farmacia_codigo,sistema_origen,documento_id,linea_id,articulo_origen_id,cantidad,importe_neto)
      VALUES ('ABA','farmatic','123','1','A-80',2,25.15),
             ('ABA','farmatic','123','2','A-82',-1,-10),
             ('EUR','farmatic','123','1','A-99',1,29.10)`);
    const {rows:[result]}=await db.query(`SELECT count(*)::int n,sum(cantidad)::numeric qty,
       sum(importe_neto)::numeric amount FROM ampedia.fm_ventas_lineas`);
    assert.equal(result.n,3);
    assert.equal(Number(result.qty),2);
    assert.equal(Number(result.amount),44.25);
    await assert.rejects(() => db.query(`INSERT INTO ampedia.fm_ventas_lineas
      (farmacia_codigo,sistema_origen,documento_id,linea_id,articulo_origen_id,cantidad)
      VALUES ('ABA','farmatic','missing','1','A-8',1)`), /foreign key/i);
    await db.query("UPDATE ampedia.fm_ventas_cabeceras SET total_documento=12.35 WHERE farmacia_codigo='ABA'");
    const {rows:[other]}=await db.query(
      "SELECT total_documento FROM ampedia.fm_ventas_cabeceras WHERE farmacia_codigo='EUR'");
    assert.equal(Number(other.total_documento),29.1);
  } finally {
    await db.end();
  }
});
