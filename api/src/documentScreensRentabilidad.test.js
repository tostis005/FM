import test from "node:test";
import assert from "node:assert/strict";
import {buildDocumentScreenSQL,DOCUMENT_SORT} from "./documentScreens.js";

test("rentabilidad agrupa por el nombre reconciliado, no por el código local",()=>{
 const sql=buildDocumentScreenSQL("rentabilidad-segmentos","ampedia",new Set(["familia","pmc","sincronizado_en"]));
 assert.match(sql,/familias_globales_articulos linked/);
 assert.match(sql,/familias_globales_alias alias/);
 assert.match(sql,/global_family\.nombre/);
 assert.match(sql,/linked\.cliente_slug=\$4/);
 assert.match(sql,/linked\.farmacia_codigo=g\.code/);
 assert.match(sql,/global_family\.cliente_slug=\$4/);
 assert.match(sql,/coalesce\(source_family\.fusionado_a,source_family\.id\)/);
 assert.match(sql,/FILTER\(WHERE pmc>0\)/);
 assert.match(sql,/GROUP BY coalesce\(family,'Sin clasificar'\)/);
 assert.doesNotMatch(sql,/nullif\(btrim\(coalesce\(art\.family,''\)\),''\) AS family/);
});

test("la consulta admite los órdenes existentes sin interpolar columnas arbitrarias",()=>{
 for(const order of Object.keys(DOCUMENT_SORT["rentabilidad-segmentos"])){
  const sql=buildDocumentScreenSQL("rentabilidad-segmentos","ampedia",new Set(["familia","pmc"]),order);
  assert.match(sql,/ORDER BY/);
 }
 assert.throws(()=>buildDocumentScreenSQL("rentabilidad-segmentos","ampedia",new Set(),"drop table"),/Orden incorrecto/);
});
