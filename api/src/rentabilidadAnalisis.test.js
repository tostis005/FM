import test from "node:test";
import assert from "node:assert/strict";
import {buildProfitabilitySQL} from "./rentabilidadAnalisis.js";
const columns=new Set(["nombre","familia","codigo_nacional","pmc","pvp","stock_actual","sincronizado_en"]);
test("resumen integra meses, farmacias y familias del maestro",()=>{
 const sql=buildProfitabilitySQL("ampedia",columns,"overview");
 assert.match(sql,/GROUP BY GROUPING SETS \(\(month\),\("pharmacyId","pharmacyName"\),\(family\)\)/);
 assert.match(sql,/farmetrica\.familias_globales_articulos linked/);
 assert.match(sql,/farmetrica\.familias_globales global_family/);
 assert.match(sql,/global_family\.id=linked\.familia_id/);
 assert.match(sql,/global_family\.nombre/);
 assert.match(sql,/r\.units\*a\.pmc/);
 assert.match(sql,/CASE WHEN a\.pmc>0 THEN r\.sales ELSE NULL END/);
 assert.doesNotMatch(sql,/\$5/);
});
test("productos usan costes por farmacia, stock y búsqueda segura",()=>{
 const sql=buildProfitabilitySQL("ampedia",columns,"products","margin","desc");
 assert.match(sql,/a\.stock_actual/);
 assert.match(sql,/ORDER BY margin DESC NULLS LAST/);
 assert.match(sql,/count\(\*\) OVER\(\)::int AS total/);
 assert.match(sql,/\$5::text=''/);
 assert.match(sql,/AND f\.id=ANY\(\$3::int\[\]\)/);
});
test("detalle de ventas pagina líneas antes de enriquecerlas",()=>{
 const sql=buildProfitabilitySQL("ampedia",columns,"sales");
 assert.match(sql,/v\.precio_unitario::numeric/);
 assert.match(sql,/v\.descuento_linea::numeric/);
 assert.match(sql,/v\.coste_historico::numeric/);
 assert.match(sql,/LIMIT \$6::int OFFSET \$7::int/);
 assert.match(sql,/SELECT \* FROM enriched/);
});
test("rechaza esquemas y ordenaciones no validados",()=>{
 assert.throws(()=>buildProfitabilitySQL("ampedia;DROP",columns,"overview"),/inválido|no válido/i);
 assert.throws(()=>buildProfitabilitySQL("ampedia",columns,"products","evil"),/inválida/);
 assert.throws(()=>buildProfitabilitySQL("ampedia",columns,"products","margin","sideways"),/inválida/);
});