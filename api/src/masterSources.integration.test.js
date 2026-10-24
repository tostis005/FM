import test from "node:test";
import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import pg from "pg";
import {importCatalog,parseCatalogCsv} from "./masterSources.js";

test("PostgreSQL: CSV de fuente externa activa versión y alimenta maestro por CN/laboratorio",{
 skip:!process.env.TEST_DB_URL
},async()=>{
 const pool=new pg.Pool({connectionString:process.env.TEST_DB_URL});
 const digest=randomBytes(32).toString("hex");
 try{
  const rows=parseCatalogCsv(Buffer.from(
   "codigo_nacional;nombre;laboratorio\n000234;Crema Zimfa CI;Zimfa\n400234;Medicamento Zimfa CI;Zimfa S.L.\n"));
  const result=await importCatalog(pool,rows,{sha:digest,version:"2026-10",
   origin:"https://example.test/catalogo",filename:"ejemplo.csv",user:"qa@example.invalid"});
  assert.equal(result.total,2);
  const imported=await pool.query("SELECT codigo,laboratorio_clave,tipo FROM farmetrica.articulos_laboratorio_maestro WHERE codigo IN ('000234','400234') AND fuente='vademecum' ORDER BY codigo");
  assert.deepEqual(imported.rows,[
   {codigo:"000234",laboratorio_clave:"N:ZIMFA",tipo:"parafarmacia"},
   {codigo:"400234",laboratorio_clave:"N:ZIMFA",tipo:"medicacion"}
  ]);
  const version=await pool.query("SELECT version,total_articulos,activo FROM farmetrica.fuentes_catalogo_versiones WHERE sha256=$1",[digest]);
  assert.deepEqual(version.rows[0],{version:"2026-10",total_articulos:2,activo:true});
 }finally{
  await pool.query("DELETE FROM farmetrica.articulos_laboratorio_maestro WHERE codigo IN ('000234','400234') AND fuente='vademecum'").catch(()=>{});
  await pool.query("DELETE FROM farmetrica.fuentes_catalogo_versiones WHERE sha256=$1",[digest]).catch(()=>{});
  await pool.end();
 }
});
