import test from "node:test";
import assert from "node:assert/strict";
import {parseReportColumnFilters,wrapReportTableSQL} from "./reportTableFilters.js";

test("solo columnas autorizadas y multiselección validada",()=>{
 assert.deepEqual(parseReportColumnFilters(JSON.stringify({
  pharmacy:["Europa","Abadía"],family:["Cosmética"],units:"12"
 }),"stock"),{pharmacy:["Europa","Abadía"],family:["Cosmética"],units:"12"});
 for(const [mod,filters] of [
  ["stock",{abcdClass:["B","C"]}],["compras",{no_existe:"DROP TABLE"}],
  ["acciones",{cn:"654321"}],["proveedores",{cn:"123"}]
 ])assert.throws(()=>parseReportColumnFilters(JSON.stringify(filters),mod));
 assert.throws(()=>parseReportColumnFilters('{"name":14}',"compras"));
 assert.throws(()=>parseReportColumnFilters('{"family":"Cosmética"}',"stock"));
 assert.throws(()=>parseReportColumnFilters("{not json}","stock"));
});
test("envuelve agregaciones completas antes del LIMIT original sin concatenar los filtros",()=>{
 const original=`SELECT f.id::text AS "pharmacyId",f.nombre AS name,
  sum(t.unidades)::float8 AS units,sum(t.importe)::float8 AS value
  FROM compras t JOIN farmetrica.farmacias f ON f.id=t.farmacia_id
  GROUP BY f.id,f.nombre ORDER BY sum(t.importe) DESC NULLS LAST,f.id LIMIT 3000`;
 const filtered=wrapReportTableSQL(original,{name:"Mayorista",units:"4"},{
  module:"proveedores",argPosition:7,sortKey:"units",sortDir:"asc"});
 assert.match(filtered,/FROM \(SELECT .* FROM compras t JOIN/s);
 assert.match(filtered,/WHERE q.name::text ILIKE/);
 assert.match(filtered,/q.units::text ILIKE/);
 assert.ok(filtered.indexOf("WHERE q.name")<filtered.indexOf("ORDER BY q.units ASC"));
 assert.ok(filtered.indexOf("ORDER BY q.units ASC")<filtered.indexOf("LIMIT 3000"));
 assert.doesNotMatch(filtered,/Mayorista/,"los valores solo viajan en parámetros");
});
test("el coste unitario de stock se calcula antes del filtro global",()=>{
 const sql=`WITH latest AS MATERIALIZED (SELECT * FROM inventario)
 SELECT f.id::text AS "pharmacyId",a.cn,a.pmc,sum(a.units) AS units,
  sum(a.value) AS "stockValue",0 AS "unpricedItems"
 FROM latest a JOIN farmetrica.farmacias f ON f.id=a.farmacia_id
 GROUP BY f.id,a.cn,a.pmc ORDER BY sum(a.units) DESC LIMIT 3000`;
 const filtered=wrapReportTableSQL(sql,{unitCost:"2",cn:"789"},{
  module:"stock",argPosition:6,source:"articulos",sortKey:"units",sortDir:"desc"});
 assert.match(filtered,/q\."stockValue"\/q.units/);
 assert.match(filtered,/q.cn::text ILIKE/);
 assert.match(filtered,/LIMIT 3000$/);
 assert.doesNotMatch(filtered,/WHERE .*LIMIT 3000.*FROM/s,
  "no se deben limitar las filas ANTES del filtrado");
});
