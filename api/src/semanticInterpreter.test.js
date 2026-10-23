import test from "node:test";
import assert from "node:assert/strict";
import {interpretSemanticQuestion,SEMANTIC_LANGUAGE_VERSION} from "./semanticInterpreter.js";
import {validateSemanticQuery} from "./aiSemanticQuery.js";

const ctx={role:"administrador",client:{slug:"ampedia",schema:"ampedia"},
 modules:{ventas:true,compras:true,stock:true},allowedPharmacyIds:[1,2],
 pharmacies:[{id:1,name:"Abadía"},{id:2,name:"Europa"}]};
const now=new Date("2026-10-23T10:00:00Z");
const resolve=q=>interpretSemanticQuestion(q,ctx,{now});
const ok=q=>{const answer=resolve(q);assert.equal(answer.estado,"ok",JSON.stringify(answer));return answer.consulta};

test("Interpretación única: venta diaria por farmacia y proveedor con intervalo español",()=>{
 const sales=ok("¿Cuánto vendió cada farmacia el 22 de octubre de 2026?");
 assert.deepEqual(sales,{fuente:"ventas",agrupar:["farmacia"],metricas:["importe"],
  desde:"2026-10-22",hasta:"2026-10-22"});
 const suppliers=ok("¿Cuánto compramos a cada proveedor entre el 1 y el 22 de octubre de 2026?");
 assert.deepEqual(suppliers,{fuente:"compras",agrupar:["proveedor"],metricas:["importe"],
  desde:"2026-10-01",hasta:"2026-10-22"});
 const annual=ok("¿Qué vendedores vendieron más desde el 1 de enero hasta el 22 de octubre de 2026?");
 assert.deepEqual(annual,{fuente:"ventas",agrupar:["farmacia","vendedor"],
  metricas:["importe"],desde:"2026-01-01",hasta:"2026-10-22",
  ordenar:{campo:"importe",direccion:"desc"},limite:30});
 for(const q of ["ventas por farmacia hoy","Ventas POR farmacia hoy","ventás por farmácia hoy"])
  assert.deepEqual(ok(q),{fuente:"ventas",agrupar:["farmacia"],metricas:["importe"],periodo:"hoy"});
 assert.equal(resolve("Ventas por farmacia hoy").version,SEMANTIC_LANGUAGE_VERSION);
});
test("No inventa significado, períodos ni accesos entre clientes",()=>{
 const ambiguous=[
  "¿Cuánto vendió cada farmacia?",
  "Ventas y compras por farmacia hoy",
  "¿Cuánto beneficio obtuvimos hoy?",
  "Compara las ventas enero de 2026 con hoy",
  "¿Cuántas ventas en la farmacia de Atlantis hoy?",
  "Ventas por farmacia el 31 de febrero de 2026"
 ];
 for(const question of ambiguous){
  const result=resolve(question);
  assert.notEqual(result.estado,"ok",question);
  assert.equal(result.consulta,undefined,question);
 }
 const denied={...ctx,modules:{ventas:false,compras:false,stock:false},role:"gestor"};
 assert.notEqual(interpretSemanticQuestion("Ventas de hoy",denied,{now}).estado,"ok");
 const chosen=ok("¿Cuánto vendimos en Abadía hoy?");
 assert.deepEqual(chosen.farmacias,[1]);
 assert.deepEqual(ok("¿Cuánto vendimos en Europa hoy?").farmacias,[2]);
});
test("Metricas, stock actual, fechas y rankings están canonizados",()=>{
 assert.deepEqual(ok("¿Cuántas unidades vendidas por producto ayer?"),
  {fuente:"ventas",agrupar:["producto"],metricas:["unidades"],periodo:"ayer"});
 assert.deepEqual(ok("¿Cuánto stock tenemos por farmacia?"),
  {fuente:"stock",agrupar:["farmacia"],metricas:["stock_actual"]});
 assert.deepEqual(ok("Top 10 vendedores con más ventas este año").limite,10);
 assert.deepEqual(ok("Top 10 productos más vendidos este mes").metricas,
  ["unidades","importe","precio_medio"]);
 assert.deepEqual(ok("Precio medio de venta por producto este mes").metricas,
  ["importe","unidades","precio_medio"]);
 assert.equal(ok("Ventas por farmacia en octubre de 2026").desde,"2026-10-01");
 assert.equal(ok("Ventas por farmacia en octubre de 2026").hasta,"2026-10-31");
 assert.equal(resolve("¿Cuál era el stock el 22 de octubre de 2026?").estado,"no_disponible");
 assert.equal(resolve("¿Qué margen tenemos hoy?").estado,"aclaracion");
 assert.equal(ok("Margen estimado de ventas este mes").metricas[0],"margen_estimado");
});
test("Cada plan aceptado supera la misma validación del MCP",()=>{
 for(const question of [
  "Ventas por farmacia hoy",
  "¿Cuánto compramos a cada proveedor entre el 1 y el 22 de octubre de 2026?",
  "Top 10 vendedores con más ventas este año",
  "¿Cuántas unidades vendidas por producto ayer?",
  "¿Cuánto stock tenemos por farmacia?"
 ])assert.doesNotThrow(()=>validateSemanticQuery(ok(question),ctx));
});


test("coste de compras ponderado por proveedor, sin confundirlo con PVP",()=>{
 for(const question of [
  "Compras por proveedor y coste unitario medio este mes",
  "Precio medio de compra por proveedor este mes",
  "Compras por proveedor coste medio este mes"
 ]){
  const resolution=resolve(question);
  assert.equal(resolution.estado,"ok",JSON.stringify(resolution));
  assert.equal(resolution.consulta.fuente,"compras");
  assert.deepEqual(resolution.consulta.metricas,["importe","unidades","coste_unitario_medio"]);
 }
 assert.equal(resolve("Precio medio de venta actual de cada producto").estado!=="ok",true,
  "no presentar precios de catálogo actuales como precio histórico");
});
