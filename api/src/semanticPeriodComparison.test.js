import test from "node:test";
import assert from "node:assert/strict";
import {parsePeriodComparison,COMPARISON_VERSION} from "./semanticPeriodComparison.js";
import {interpretSemanticQuestion} from "./semanticInterpreter.js";
import {validateSemanticQuery} from "./aiSemanticQuery.js";

const ctx={role:"administrador",client:{slug:"ampedia",schema:"ampedia"},
 modules:{ventas:true,compras:true,stock:true},allowedPharmacyIds:[1,2],
 pharmacies:[{id:1,name:"Abadía"},{id:2,name:"Europa"}]};
const now=new Date("2026-10-23T08:00:00Z");
const compare=q=>interpretSemanticQuestion(q,ctx,{now});
test("meses arbitrarios: Farmétrica fija fechas y no delega la elección en una IA",()=>{
 const r=compare("Compara ventas por farmacia de enero de 2026 frente a febrero de 2026");
 assert.equal(r.estado,"ok",r.mensaje);
 assert.equal(r.comparacion.version,COMPARISON_VERSION);
 assert.deepEqual(r.comparacion.actual.desde,"2026-01-01");
 assert.deepEqual(r.comparacion.actual.hasta,"2026-01-31");
 assert.deepEqual(r.comparacion.anterior.desde,"2026-02-01");
 assert.deepEqual(r.comparacion.anterior.hasta,"2026-02-28");
 assert.deepEqual(r.comparacion.dimensiones,["farmacia"]);
 for(const p of [r.comparacion.actual,r.comparacion.anterior])
  assert.doesNotThrow(()=>validateSemanticQuery(p,ctx));
});
test("dos años completos y rangos en español o ISO numérico",()=>{
 const a=compare("Ventas 2025 vs 2026");
 assert.equal(a.estado,"ok",a.mensaje);
 assert.deepEqual(a.comparacion.actual.desde,"2025-01-01");
 assert.deepEqual(a.comparacion.anterior.hasta,"2026-12-31");
 for(const q of [
  "Compara ventas del 1 al 15 de octubre de 2026 con las del 1 al 15 de septiembre de 2026",
  "Compara ventas del 01/10/2026 al 15/10/2026 vs del 01/09/2026 al 15/09/2026"
 ]){
  const r=compare(q);
  assert.equal(r.estado,"ok",r.mensaje);
  assert.deepEqual([r.comparacion.actual.desde,r.comparacion.actual.hasta],["2026-10-01","2026-10-15"]);
  assert.deepEqual([r.comparacion.anterior.desde,r.comparacion.anterior.hasta],["2026-09-01","2026-09-15"]);
  assert.deepEqual(r.comparacion.dimensiones,[]);
 }
});
test("fechas incorrectas y terceros períodos rechazan consulta; stock histórico no permitido",()=>{
 for(const q of [
  "Compara ventas de febrero de 2025 frente a febrero de 2026 y marzo de 2026",
  "Compara ventas del 29 al 31 de febrero de 2026 con las del 1 al 3 de marzo de 2026",
  "Compara ventas enero de 2026 febrero de 2026",
  "Compara ventas enero de 2026 frente a hoy",
  "Compara stock enero de 2026 frente a febrero de 2026",
  "Compara margen estimado de ventas de enero 2026 frente a febrero 2026"
 ]){
  const r=compare(q);
  assert.notEqual(r.estado,"ok",q);
  assert.equal(r.consulta,undefined,q);
 }
});
test("comparaciones relativas existentes siguen funcionando",()=>{
 const r=compare("Compara ventas por farmacia este mes respecto al mes pasado");
 assert.equal(r.estado,"ok",r.mensaje);
 assert.equal(r.comparacion.actual.desde,"2026-10-01");
 assert.equal(r.comparacion.anterior.desde,"2026-09-01");
 assert.equal(parsePeriodComparison("¿Cuánto vendió cada farmacia ayer?",{now}),null);
});
