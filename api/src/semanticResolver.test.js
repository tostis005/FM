import test from "node:test";
import assert from "node:assert/strict";
import {parsePeriodComparison} from "./semanticPeriodComparison.js";
import {interpretSemanticQuestion} from "./semanticInterpreter.js";
import {resolveAndExecuteQuestion,formatComparisonAnswer} from "./semanticResolver.js";

const now=new Date("2026-10-23T10:00:00Z");
const ctx={role:"administrador",client:{slug:"ampedia",schema:"ampedia"},
 modules:{ventas:true,compras:true,stock:true},allowedPharmacyIds:[1,2],
 pharmacies:[{id:1,name:"Abadía"},{id:2,name:"Europa"}]};
const resolve=q=>interpretSemanticQuestion(q,ctx,{now});

test("mes actual y anterior se comparan con igual número de días, siempre Europe/Madrid",()=>{
 const a=parsePeriodComparison("Ventas de este mes respecto al mes pasado",{now});
 assert.deepEqual(a.actual,{desde:"2026-10-01",hasta:"2026-10-23"});
 assert.deepEqual(a.anterior,{desde:"2026-09-01",hasta:"2026-09-23"});
 const atMonthEnd=parsePeriodComparison("Ventas este mes frente al mes pasado",{
  now:new Date("2026-03-31T12:00:00Z")});
 assert.deepEqual(atMonthEnd.actual,{desde:"2026-03-01",hasta:"2026-03-28"});
 assert.deepEqual(atMonthEnd.anterior,{desde:"2026-02-01",hasta:"2026-02-28"});
});
test("comparaciones de año, semana y días se resuelven sin plan del modelo",()=>{
 const year=resolve("¿Cuánto hemos vendido este año frente al año pasado?");
 assert.equal(year.estado,"ok");
 assert.deepEqual(year.comparacion.anterior.desde,"2025-01-01");
 assert.deepEqual(year.comparacion.actual.hasta,"2026-10-23");
 const week=resolve("Compara ventas por farmacia esta semana respecto a la semana pasada");
 assert.equal(week.estado,"ok");
 assert.deepEqual(week.comparacion.anterior.desde,"2026-10-12");
 assert.deepEqual(week.comparacion.actual.hasta,"2026-10-23");
 const day=resolve("Compara ventas por farmacia hoy con ayer");
 assert.equal(day.estado,"ok");
 assert.deepEqual(day.comparacion.anterior.desde,"2026-10-22");
});
test("ranking de vendedores y compras por proveedor usan la misma semántica central",()=>{
 const sellers=resolve("¿Qué vendedores han aumentado más sus ventas respecto al mes pasado?");
 assert.equal(sellers.estado,"ok",sellers.mensaje);
 assert.deepEqual(sellers.comparacion.dimensiones,["farmacia","vendedor"]);
 assert.deepEqual(sellers.comparacion.anterior.metricas,["importe"]);
 assert.equal(sellers.comparacion.anterior.limite,100);
 assert.equal(sellers.comparacion.actual.limite,100);
 assert.equal(sellers.comparacion.direccion,"desc");
 const suppliers=resolve("Compara compras a cada proveedor este mes con el mes pasado");
 assert.equal(suppliers.estado,"ok",suppliers.mensaje);
 assert.deepEqual(suppliers.comparacion.dimensiones,["proveedor"]);
});
test("no hay comparación engañosa para métricas no disponibles, fechas ambiguas o fuentes múltiples",()=>{
 for(const question of [
  "Diferencia entre ventas y compras",
  "Compara ventas por farmacia en abril con marzo",
  "Compara el stock de hoy con ayer",
  "¿Cómo ha crecido el beneficio neto respecto al mes pasado?",
  "Compara margen estimado de ventas este mes respecto al mes pasado"
 ]){
  const answer=resolve(question);
  assert.notEqual(answer.estado,"ok",question);
  assert.equal(answer.consulta,undefined,question);
 }
});
test("la comparación se calcula a partir de dos consultas READ ONLY; 0 previo no tiene porcentaje",async()=>{
 const queryCalls=[];
 const pool={connect:async()=>({query:async(sql,params=[])=>{
  queryCalls.push({sql,params});
  if(sql.startsWith("SELECT"))return {rows:params[0]==="2026-09-01"?
   [{farmaciaId:1,farmacia:"Abadía",importe:50},{farmaciaId:2,farmacia:"Europa",importe:0}]:
   [{farmaciaId:1,farmacia:"Abadía",importe:75},{farmaciaId:2,farmacia:"Europa",importe:20}]};
  return {rows:[]};
 },release(){}})};
 const data=await resolveAndExecuteQuestion(pool,ctx,
  "Compara ventas por farmacia este mes respecto al mes pasado",{now});
 assert.equal(data.estado,"ok");
 assert.equal(data.modo,"comparacion_semantica");
 assert.equal(data.filas.length,2);
 assert.equal(data.filas[0].farmacia,"Abadía");
 assert.equal(data.filas[0].diferencia,25);
 assert.equal(data.filas[0].variacion_pct,50);
 assert.equal(data.filas[1].variacion_pct,null);
 assert.match(formatComparisonAnswer(data),/Abadía/);
 assert.match(formatComparisonAnswer(data),/€|EUR/);
 assert.equal(queryCalls.filter(q=>q.sql==="BEGIN TRANSACTION READ ONLY").length,2);
 assert.ok(queryCalls.every(q=>!/\bDELETE\b/i.test(q.sql)));
});
test("límite de 100 grupos rechaza rankings incompletos",async()=>{
 const pool={connect:async()=>({query:async(sql,params=[])=>{
  if(sql.startsWith("SELECT"))return {rows:Array.from({length:100},(_,i)=>({
   farmaciaId:1,farmacia:"Abadía",importe:10+i
  }))};return {rows:[]};
 },release(){}})};
 const result=await resolveAndExecuteQuestion(pool,ctx,
  "Compara ventas por farmacia este mes respecto al mes pasado",{now});
 assert.equal(result.estado,"no_disponible");
 assert.equal(result.filas,undefined);
});

test("interpreta NUMERIC de PostgreSQL en texto y no inventa ceros en grupos ausentes",async()=>{
 const pool={connect:async()=>({query:async(sql,params=[])=>{
  if(sql.startsWith("SELECT")){
   if(params[0]==="2026-09-01")return {rows:[
    {farmaciaId:1,farmacia:"Abadía",importe:"50.00"},
    {farmaciaId:2,farmacia:"Europa",importe:"10.00"}
   ]};
   return {rows:[{farmaciaId:1,farmacia:"Abadía",importe:"75.25"}]};
  }
  return {rows:[]};
 },release(){}})};
 const data=await resolveAndExecuteQuestion(pool,ctx,
  "Compara ventas por farmacia este mes respecto al mes pasado",{now});
 assert.equal(data.estado,"ok");
 assert.equal(data.filas.length,2);
 const abad=data.filas.find(x=>x.farmaciaId===1);
 assert.equal(abad.anterior,50);
 assert.equal(abad.actual,75.25);
 assert.equal(abad.diferencia,25.25);
 assert.equal(abad.variacion_pct,50.5);
 const europa=data.filas.find(x=>x.farmaciaId===2);
 assert.equal(europa.anterior,10);
 assert.equal(europa.actual,null);
 assert.equal(europa.diferencia,null);
 assert.equal(europa.variacion_pct,null);
 assert.equal(europa.estado,"sin_datos_actuales");
 assert.match(formatComparisonAnswer(data),/faltan datos verificables/);
 assert.ok(data.advertencias.some(x=>x.includes("no se interpreta como importe cero")));
});
test("rechaza resultados sin ID de farmacia o con claves de agrupación duplicadas",async()=>{
 for(const rows of [
  [{farmacia:"Europa",importe:"100"}],
  [{farmaciaId:1,farmacia:"Abadía",importe:"100"},
   {farmaciaId:1,farmacia:"Abadía",importe:"20"}]
 ]){
  const pool={connect:async()=>({query:async(sql)=>{
   if(sql.startsWith("SELECT"))return {rows};
   return {rows:[]};
  },release(){}})};
  const data=await resolveAndExecuteQuestion(pool,ctx,
   "Compara ventas por farmacia este mes respecto al mes pasado",{now});
  assert.equal(data.estado,"no_disponible");
  assert.equal(data.filas,undefined);
 }
});
test("un valor nulo, infinito o con unidad monetaria no se convierte en cifra",async()=>{
 for(const invalid of ["NaN","10 €",null]){
  const pool={connect:async()=>({query:async(sql)=>{
   if(sql.startsWith("SELECT"))return {rows:[{farmaciaId:1,farmacia:"Abadía",importe:invalid}]};
   return {rows:[]};
  },release(){}})};
  const data=await resolveAndExecuteQuestion(pool,ctx,
   "Compara ventas por farmacia este mes respecto al mes pasado",{now});
  assert.equal(data.estado,"no_disponible");
  assert.equal(data.filas,undefined);
 }
});
