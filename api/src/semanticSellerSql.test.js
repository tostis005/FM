import test from "node:test";
import assert from "node:assert/strict";
import {compileSemanticQuery,validateSemanticQuery} from "./aiSemanticQuery.js";

const ctx={role:"administrador",client:{schema:"ampedia",slug:"ampedia"},
 modules:{ventas:true,compras:true,stock:true},allowedPharmacyIds:[1,2],
 pharmacies:[{id:1,name:"Abadía"},{id:2,name:"Europa"}]};
test("consulta anual de vendedores compila SQL ligero e idénticos totales",()=>{
 const plan={fuente:"ventas",agrupar:["farmacia","vendedor"],metricas:["importe"],
  desde:"2026-01-01",hasta:"2026-10-22",ordenar:{campo:"importe",direccion:"desc"},limite:30};
 const compiled=compileSemanticQuery(plan,ctx);
 assert.match(compiled.sql,/FROM "ampedia"\.fm_ventas_analitica t/);
 assert.match(compiled.sql,/f\.id=ANY\(\$3::int\[\]\)/);
 assert.match(compiled.sql,/f\.cliente_slug=\$4/);
 assert.match(compiled.sql,/t\.fecha >= \$1::date/);
 assert.match(compiled.sql,/t\.fecha < \(\$2::date \+ interval '1 day'\)/);
 assert.match(compiled.sql,/GROUP BY f\.id,f\.nombre,nullif\(btrim\(t\.vendedor_id::text\)/);
 assert.doesNotMatch(compiled.sql,/to_char|LEFT JOIN LATERAL|OR t\.fecha|OR t\.vendedor_id/);
 assert.deepEqual(compiled.params,["2026-01-01","2026-10-22",[1,2],"ampedia",30]);
 assert.deepEqual(compiled.q.metrics,["importe"]);
});
test("filtros de vendedor y todas las métricas conservan parámetros seguros",()=>{
 const x=compileSemanticQuery({fuente:"ventas",agrupar:["farmacia","vendedor"],
  vendedor:"37",metricas:["importe","unidades","movimientos"],periodo:"hoy"},ctx);
 assert.match(x.sql,/t\.vendedor_id::text=\$5/);
 assert.match(x.sql,/sum\(t\.unidades\)/);
 assert.match(x.sql,/count\(\*\)::int/);
 assert.equal(x.params[4],"37");
 assert.equal(x.params.at(-1),30);
 assert.equal(x.params[3],"ampedia");
 assert.doesNotMatch(x.sql,/(?:DROP|DELETE|UPDATE) /);
});
test("otras agrupaciones mantienen SQL genérico, con predicado indexable",()=>{
 const x=compileSemanticQuery({fuente:"ventas",agrupar:["farmacia"],
  metricas:["importe"],desde:"2026-10-01",hasta:"2026-10-22"},ctx);
 assert.match(x.sql,/t\.fecha >= \$1::date/);
 assert.doesNotMatch(x.sql,/\$1::date IS NULL OR/);
 const y=compileSemanticQuery({fuente:"ventas",agrupar:["anio"],
  metricas:["importe"],periodo:"historico"},ctx);
 assert.doesNotMatch(y.sql,/t\.fecha >= \$1::date/);
 assert.deepEqual(y.params.slice(0,2),[null,null]);
 assert.throws(()=>validateSemanticQuery({fuente:"ventas",agrupar:["farmacia"],metricas:["importe"],
  farmacias:[999]},ctx),/autorizadas/);
});
