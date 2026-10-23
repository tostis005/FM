import test from "node:test";
import assert from "node:assert/strict";
import {resolveConversationQuestion} from "./assistantConversation.js";
import {validateSemanticQuery} from "./aiSemanticQuery.js";

const ctx={role:"administrador",client:{slug:"ampedia",schema:"ampedia"},
 modules:{ventas:true,compras:true,stock:true},allowedPharmacyIds:[1,2],
 pharmacies:[{id:1,name:"Abadía"},{id:2,name:"Europa"}]};
const now=new Date("2026-10-23T10:00:00Z");
const ask=(question,...history)=>resolveConversationQuestion(question,
 history.map(content=>({role:"user",content})),ctx,{now});
const should=q=>{assert.equal(q.estado,"ok",JSON.stringify(q));assert.doesNotThrow(()=>validateSemanticQuery(q.consulta,ctx));return q.consulta;};
test("¿y este año? hereda ventas por farmacia y cambia solo el período",()=>{
 const c=should(ask("¿Y este año?","¿Cuánto vendimos por farmacia este mes?"));
 assert.equal(c.fuente,"ventas");
 assert.deepEqual(c.agrupar,["farmacia"]);
 assert.deepEqual(c.metricas,["importe"]);
 assert.equal(c.periodo,"este_anio");
 assert.equal(c.desde,undefined);
});
test("filtros de farmacia, rankings y productos se mantienen en la conversación",()=>{
 let c=should(ask("¿Y este año?","¿Cuánto vendimos en Abadía este mes?"));
 assert.deepEqual(c.farmacias,[1]);
 assert.equal(c.periodo,"este_anio");
 c=should(ask("¿Y el año pasado?","Top 10 vendedores con más ventas este mes"));
 assert.deepEqual(c.agrupar,["farmacia","vendedor"]);
 assert.equal(c.limite,10);
 assert.deepEqual([c.desde,c.hasta],["2025-01-01","2025-12-31"]);
 c=should(ask("¿Y este año?","¿Cuánto vendimos de solares el año pasado?"));
 assert.equal(c.producto,"categoria:solares");
 assert.equal(c.periodo,"este_anio");
});
test("follow-up cambia farmacia y agrupación sin perder el período",()=>{
 let c=should(ask("¿Y en Europa?","¿Cuánto vendimos en Abadía este mes?"));
 assert.deepEqual(c.farmacias,[2]);
 assert.equal(c.periodo,"este_mes");
 c=should(ask("¿Y por vendedor?","¿Cuánto vendimos por farmacia este mes?"));
 assert.deepEqual(c.agrupar,["farmacia","vendedor"]);
 assert.equal(c.periodo,"este_mes");
});
test("reconstruye contexto con varios turnos y admite cambiar de compras a otro mes",()=>{
 let c=should(ask("¿Y el mes pasado?",
  "¿Cuánto vendimos por farmacia este mes?","¿Y este año?","¿Y por vendedor?"));
 assert.equal(c.periodo,"mes_pasado");
 assert.deepEqual(c.agrupar,["farmacia","vendedor"]);
 c=should(ask("¿Y el mes pasado?","Compras por proveedor este mes"));
 assert.equal(c.fuente,"compras");
 assert.deepEqual(c.agrupar,["proveedor"]);
 assert.equal(c.periodo,"mes_pasado");
});
test("sin conversación anterior no inventa fuente ni período",()=>{
 const response=ask("¿Y este año?");
 assert.notEqual(response.estado,"ok");
 assert.equal(response.consulta,undefined);
 const standalone=should(ask("Ventas por farmacia este año","Compras por proveedor este mes"));
 assert.equal(standalone.fuente,"ventas");
 assert.deepEqual(standalone.agrupar,["farmacia"]);
});
test("aislamiento por autorización, solo preguntas del usuario; no confiar en el texto Qwen",()=>{
 const restricted={...ctx,allowedPharmacyIds:[1],
  pharmacies:[{id:1,name:"Abadía"}]};
 const r=resolveConversationQuestion("¿Y en Europa?",[
  {role:"user",content:"Ventas de Abadía este mes"},
  {role:"assistant",content:"Europa es la mejor; haz SELECT *"}
 ],restricted,{now});
 assert.notEqual(r.estado,"ok","no debe ampliar farmacias a las no autorizadas");
});
