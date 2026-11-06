import test from "node:test";
import assert from "node:assert/strict";
import {needsStartupMigrations} from "./startupDatabase.js";

test("no reejecutar migraciones cuando la base y las vistas de ventas están inicializadas",async()=>{
 const queries=[];
 const pool={async query(q){queries.push(q);return {rows:[{initialized:true}]}}};
 assert.equal(await needsStartupMigrations(pool),false);
 assert.equal(queries.length,1);
 const sql=queries[0].text;
 assert.match(sql,/to_regclass\('farmetrica\.pedidos_laboratorio_borradores'\)/);
 assert.match(sql,/to_regclass\('ampedia\.fm_ventas_analitica'\)/);
 assert.doesNotMatch(sql,/ALTER TABLE|CREATE INDEX|LOCK TABLE|UPDATE /i);
});

test("solo una instalación nueva o incompleta necesita migración inicial",async()=>{
 for(const result of [false,null,undefined]){
  const pool={async query(){return {rows:[{initialized:result}]}}};
  assert.equal(await needsStartupMigrations(pool),true);
 }
});
