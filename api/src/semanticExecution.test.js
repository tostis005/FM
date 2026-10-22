import test from "node:test";
import assert from "node:assert/strict";
import {combineCanonicalPeriods,writeCanonicalComparison,executeCanonicalQuestion} from "./semanticExecution.js";

const dims=["farmacia"],metric="importe";
test("diferencias de ventas auditadas con claves farmacias, euros y porcentajes",()=>{
 const rows=combineCanonicalPeriods(
  [{farmaciaId:2,farmacia:"Europa",importe:"126.50"},{farmaciaId:1,farmacia:"Abadía",importe:200}],
  [{farmaciaId:1,farmacia:"Abadía",importe:"100.00"},{farmaciaId:2,farmacia:"Europa",importe:"100"}],
  {dimensions:dims,metric});
 assert.deepEqual(rows,[
  {farmaciaId:1,farmacia:"Abadía",actual:200,anterior:100,diferencia:100,variacion_pct:100,estado:"completo"},
  {farmaciaId:2,farmacia:"Europa",actual:126.5,anterior:100,diferencia:26.5,variacion_pct:26.5,estado:"completo"}
 ]);
 const written=writeCanonicalComparison({filas:rows,metrica:"importe",fuente:"ventas",
  comparacion:{actual:{desde:"2026-10-01",hasta:"2026-10-23"},
   anterior:{desde:"2026-09-01",hasta:"2026-09-23"}}});
 assert.match(written,/Abadía/);
 assert.match(written,/200,00 €/);
 assert.match(written,/100,00 %/);
 assert.doesNotMatch(written,/\$/);
});
test("sin datos no se rellena con cero; la base cero no produce porcentajes infinitos",()=>{
 const rows=combineCanonicalPeriods(
  [{farmaciaId:1,farmacia:"Abadía",importe:0},{farmaciaId:3,farmacia:"Buenavista",importe:42}],
  [{farmaciaId:1,farmacia:"Abadía",importe:0},{farmaciaId:2,farmacia:"Europa",importe:10}],
  {dimensions:dims,metric});
 assert.equal(rows[0].diferencia,0);
 assert.equal(rows[0].variacion_pct,null);
 assert.equal(rows[1].estado,"sin_datos_actuales");
 assert.equal(rows[1].actual,null);
 assert.equal(rows[1].diferencia,null);
 assert.equal(rows[2].estado,"sin_datos_anteriores");
 assert.equal(rows[2].anterior,null);
 assert.equal(rows[2].variacion_pct,null);
 assert.match(writeCanonicalComparison({filas:rows,metrica:"importe",fuente:"ventas",
  comparacion:{actual:{desde:"2026-10-23",hasta:"2026-10-23"},
   anterior:{desde:"2026-10-22",hasta:"2026-10-22"}}}),/faltan datos verificables/);
 assert.deepEqual(combineCanonicalPeriods([],[],{dimensions:[],metric:"unidades"}),[]);
});
test("rechaza resultados parciales, IDs desconocidos, duplicados y métricas no comparables",()=>{
 assert.throws(()=>combineCanonicalPeriods(
  [{farmacia:"Sin ID",importe:3}],[],{dimensions:dims,metric}),/identificador/);
 assert.throws(()=>combineCanonicalPeriods(
  [{farmaciaId:1,importe:1},{farmaciaId:1,importe:2}],[],{dimensions:dims,metric}),/duplicados/);
 assert.throws(()=>combineCanonicalPeriods(
  [],[],{dimensions:["vendedor"],metric}),/totales/);
 assert.throws(()=>combineCanonicalPeriods(
  [],[],{dimensions:dims,metric:"margen_estimado"}),/aditivas/);
 const row=Array.from({length:100},(_,i)=>({farmaciaId:i+1,importe:1}));
 assert.throws(()=>combineCanonicalPeriods(row,[],{dimensions:dims,metric}),/límite seguro/);
});
test("el ejecutor devuelve aclaraciones sin consultar PostgreSQL",async()=>{
 const context={role:"gestor",client:{slug:"ampedia",schema:"ampedia"},
  modules:{ventas:true,compras:true,stock:true},allowedPharmacyIds:[1],
  pharmacies:[{id:1,name:"Abadía"}]};
 const pool={query(){throw Error("NO DEBE CONSULTAR DATOS")},connect(){throw Error("NO DB")}};
 const answer=await executeCanonicalQuestion(pool,context,"Compara las ventas de ayer con mi beneficio");
 assert.notEqual(answer.estado,"comparacion");
 assert.equal(answer.filas,undefined);
});
