import test from "node:test";
import assert from "node:assert/strict";
import {promotionCatalogSearchSQL} from "./promotionCatalogSearch.js";

const fields=(table,columns)=>columns.map(column_name=>({table_name:table,column_name}));
const articles=fields("articulos",["farmacia_codigo","origen_id","nombre","codigo_nacional",
 "laboratorio","proveedor_id"]);
const suppliers=fields("proveedores",["farmacia_codigo","origen_id","nombre"]);

test("busca nombre de artículo, CN, laboratorio y proveedor en el mismo tenant",()=>{
 const sql=promotionCatalogSearchSQL("ampedia",[...articles,...suppliers]);
 assert.match(sql,/a\.nombre::text ILIKE/);
 assert.match(sql,/a\.codigo_nacional::text ILIKE/);
 assert.match(sql,/a\.laboratorio/);
 assert.match(sql,/pr\.nombre ILIKE/);
 assert.match(sql,/pm\.nombre ILIKE/);
 assert.match(sql,/pm\.cliente_slug=\$1/);
 assert.match(sql,/f\.id=ANY\(\$2::int\[\]\)/);
 assert.match(sql,/upper\(btrim\(pr\.farmacia_codigo::text\)\)=upper\(btrim\(a\.farmacia_codigo::text\)\)/);
 assert.match(sql,/CASE WHEN btrim\(a\.codigo_nacional::text\)/);
 assert.doesNotMatch(sql,/CASE WHEN btrim\(a\.origen_id/);
 assert.match(sql,/LIMIT 400$/);
});
test("funciona sin tabla de proveedores ni referencia a laboratorio",()=>{
 const sql=promotionCatalogSearchSQL("ampedia",fields("articulos",[
  "farmacia_codigo","origen_id","nombre","codigo_nacional"
 ]));
 assert.match(sql,/a\.nombre::text ILIKE/);
 assert.doesNotMatch(sql,/\.proveedores pr/);
 assert.doesNotMatch(sql,/proveedores_maestro pm/);
});
test("rechaza esquemas inseguros o catálogos sin CN",()=>{
 assert.throws(()=>promotionCatalogSearchSQL("a\";drop table x",articles),/Esquema/);
 assert.throws(()=>promotionCatalogSearchSQL("ampedia",fields("articulos",[
  "farmacia_codigo","origen_id","nombre"
 ])),/campos necesarios/);
});
