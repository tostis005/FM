import test from "node:test";
import assert from "node:assert/strict";
import {parseProposedPlan,plannerPrompt,shouldTryAssistantPlanner} from "./assistantPlanner.js";
import {adaptiveAssistantResolution} from "./assistant.js";
import {compileSemanticQuery,semanticCatalogForContext} from "./aiSemanticQuery.js";
import {presentSemanticResult} from "./semanticPresentation.js";
const ctx={role:"administrador",client:{slug:"ampedia",schema:"ampedia"},
 modules:{dashboard:true,ventas:true,compras:true,stock:true},
 allowedPharmacyIds:[1,2],pharmacies:[{id:1,name:"Abadía"},{id:2,name:"Europa"}]};
const now=new Date("2026-10-23T10:00:00Z");
const previous={version:"farmetrica.nl.v1",estado:"ok",
 consulta:{fuente:"ventas",agrupar:["farmacia","producto"],
  metricas:["unidades","importe"],periodo:"este_mes",
  ordenar:{campo:"unidades",direccion:"desc"},limite:10}};
test("plan dinámico: productos, unidades, ventas y precio medio auditado",()=>{
 const json=JSON.stringify({fuente:"ventas",agrupar:["farmacia","producto"],
  metricas:["unidades","importe","precio_medio"],
  periodo:"este_anio",limite:20,ordenar:{campo:"unidades",direccion:"desc"}});
 const proposal=parseProposedPlan(json,ctx,{question:"¿Y a qué precio medio se vendieron?",previous,now});
 assert.deepEqual(proposal?.metricas,["unidades","importe","precio_medio"]);
 assert.equal(proposal?.periodo,"este_mes","no aceptar que la IA cambie el periodo de un seguimiento");
 const compiled=compileSemanticQuery(proposal,ctx);
 assert.match(compiled.sql,/sum\(b\.importe\)\/nullif\(sum\(b\.unidades\),0\)/);
 assert.ok(compiled.sql.includes('AS "precio_medio"'));
 const result=presentSemanticResult({estado:"ok",fuente:"ventas",
  dimensiones:["farmacia","producto"],metricas:["unidades","importe","precio_medio"],
  periodo:{desde:"2026-10-01",hasta:"2026-10-23"},
  filas:[{farmacia:"Abadía",producto:"Protector solar",unidades:10,importe:120,precio_medio:12}]});
 assert.equal(result.filas[0]["Precio medio"],"12,00 €");
 assert.equal(result.filas[0]["Ventas"],"120,00 €");
});
test("planes SQL libres, dimensiones ficticias y farmacias no autorizadas fallan",()=>{
 for(const raw of [
  {fuente:"ventas",metricas:["importe"],sql:"SELECT * FROM users",periodo:"este_mes"},
  {fuente:"ventas",metricas:["precio_compra_actual"],periodo:"este_mes"},
  {fuente:"ventas",metricas:["precio_medio"],agrupar:["cliente"],periodo:"este_mes"},
  {fuente:"ventas",metricas:["precio_medio"],farmacias:[999],periodo:"este_mes"},
  {fuente:"ventas",metricas:["precio_medio"],periodo:"este_mes",limite:100000}
 ])assert.equal(parseProposedPlan(JSON.stringify(raw),ctx,{question:"Precio de venta este mes",now}),null);
 assert.equal(parseProposedPlan(JSON.stringify({fuente:"ventas",metricas:["importe"],
  periodo:"este_mes"}),ctx,{question:"¿Qué PVP actual tenemos?",now}),null);
 assert.equal(parseProposedPlan('{"fuente":"ventas","metricas":["importe"]}',ctx,
  {question:"¿Cuánto vendimos?",now}),null,"un período no solicitado no se puede inventar");
});
test("modelo planifica solo cuando la regla no entiende la pregunta",()=>{
 assert.equal(shouldTryAssistantPlanner("Buenos días",{estado:"general"}),false);
 assert.equal(shouldTryAssistantPlanner("¿Qué precio de catálogo hay?",{estado:"general"}),false);
 assert.equal(shouldTryAssistantPlanner("Ventas por farmacia hoy",
  {estado:"ok",consulta:{fuente:"ventas",metricas:["importe"]}}),false);
 const prompt=plannerPrompt("Precio medio de ventas por producto este mes",[],ctx,{now});
 assert.ok(prompt[1].content.includes("precio_medio"));
 assert.ok(!prompt[1].content.includes("clientes no autorizados"));
});
test("Ollama propone plan sin ejecutar SQL; error mantiene respuesta semántica",async()=>{
 const history=[{role:"user",content:"Top 10 productos más vendidos este mes"}];
 let calls=0;
 const generate=async(_q,_history,_context,_result,_url,_model,settings)=>{
  calls++;
  assert.equal(settings.format,"json");
  assert.ok(settings.planMessages[1].content.includes("precio_medio"));
  return JSON.stringify({fuente:"ventas",agrupar:["farmacia","producto"],
   metricas:["unidades","importe","precio_medio"],periodo:"este_anio",
   ordenar:{campo:"unidades",direccion:"desc"},limite:10});
 };
 const r=await adaptiveAssistantResolution("¿Y el precio medio?",history,ctx,{now,generate});
 assert.equal(r.estado,"ok");
 assert.deepEqual(r.consulta.metricas,["importe","unidades","precio_medio"]);
 assert.equal(r.consulta.periodo,"este_mes");
 assert.equal(calls,0,"follow-up reconocido por motor semántico no necesita IA");
 const family=await adaptiveAssistantResolution("Ventas por familia este mes",[],ctx,{
  now,generate:async(_question,_history,_context,_results,_url,_model,settings)=>{
   calls++;
   assert.equal(settings.format,"json");
   return JSON.stringify({fuente:"ventas",agrupar:["familia"],
    metricas:["importe","unidades"],periodo:"este_mes"});
  }
 });
 assert.equal(family.estado,"ok");
 assert.deepEqual(family.consulta.agrupar,["familia"]);
 assert.deepEqual(family.consulta.metricas,["importe","unidades"]);
 assert.equal(calls,1,"se usa planificador para dimensiones que el intérprete omite");
 const rejected=await adaptiveAssistantResolution("Ventas por familia este mes",[],ctx,{
  now,generate:async()=>JSON.stringify({fuente:"ventas",metricas:["importe"],
   agrupar:["untrusted_table"],periodo:"este_mes"})
 });
 assert.equal(rejected.consulta.agrupar.includes("familia"),false,
  "un plan con dimensión ficticia no se ejecuta, se conserva ruta segura");

});
