import test from "node:test";
import assert from "node:assert/strict";
import {evaluateMonitor,pharmacySyncSummary,setupPharmacyState} from "./pharmacyState.js";

test("sin filas recientes no se afirma avería de VPN, pero se conservan incidencias explícitas",()=>{
 const p={id:"1",name:"Centro",active:true,sourceCode:"ABA"};
 const old={ventas:{lastReceivedAt:"2026-10-16T08:00:00.000Z"}};
 const now=new Date("2026-10-21T08:00:00.000Z");
 const stale=pharmacySyncSummary(p,[],old,now);
 assert.equal(stale.state,"Sin actividad reciente");
 assert.equal(stale.incidents.length,0);
 const failed=pharmacySyncSummary(p,[{flow:"compras",state:"error",startedAt:"2026-10-21T07:00:00.000Z",
  finishedAt:"2026-10-21T07:01:00.000Z",error:"Fallo al leer el origen"}],old,now);
 assert.equal(failed.state,"Revisar");
 assert.equal(failed.incidents[0].error,"Fallo al leer el origen");
 const rejected=pharmacySyncSummary(p,[{flow:"compras",state:"completado",
  startedAt:"2026-10-21T07:00:00Z",finishedAt:"2026-10-21T07:01:00Z",
  rejected:3,error:null}],old,now);
 assert.equal(rejected.state,"Revisar");
 assert.match(rejected.incidents[0].error,/3 registros rechazados/);
 assert.equal(pharmacySyncSummary(p,[],{ventas:{lastReceivedAt:"2026-10-21T07:40:00.000Z"}},now).state,"Actividad reciente");
});

test("Estado devuelve todas las farmacias autorizadas, incluidas las sin recepciones",async()=>{
 const routes={},queries=[];
 const app={get(path,...handlers){routes[path]=handlers.at(-1)}};
 const pool={async query(query,args){
  const sql=typeof query==="string"?query:query.text;
  queries.push({sql,args});
  if(sql.includes("information_schema.tables"))return {rows:[
   {table_name:"fm_sync_ejecuciones"},{table_name:"fm_ventas_cabeceras"},{table_name:"fm_recepciones_cabeceras"}]};
  if(sql.includes(".fm_sync_ejecuciones"))return {rows:[{code:"ABA",flow:"ventas_completas",state:"completado",
   startedAt:"2026-10-21T07:00:00Z",finishedAt:"2026-10-21T07:01:00Z",read:10,inserted:4,rejected:0,error:null}]};
  if(sql.includes(".fm_ventas_cabeceras"))return {rows:[{code:"ABA",lastReceivedAt:"2026-10-21T07:00:00Z",lastDocumentAt:"2026-10-21T06:59:00Z"}]};
  if(sql.includes(".fm_recepciones_cabeceras"))return {rows:[]};
  throw Error("SQL inesperado: "+sql);
 }};
 setupPharmacyState(app,pool,{requireTenant:()=>[]});
 let json,error;
 await routes["/api/tenant/estado"]({context:{role:"gestor",client:{slug:"ampedia",schema:"ampedia"},
  pharmacies:[{id:"1",name:"Farmacia Abadía",active:true,sourceCode:"ABA",databaseCode:"ABA"},
   {id:"2",name:"Farmacia Europa",active:true,sourceCode:"EUR",databaseCode:"EUR"}]}},
 {json(v){json=v;return this},status(){return this}},e=>{error=e});
 if(error)throw error;
 assert.equal(json.pharmacies.length,2);
 assert.equal(json.pharmacies[0].flows[0].flow,"ventas_completas");
  assert.ok(queries.filter(x=>x.sql.includes("fm_sync_")).every(x=>x.sql.includes("NOT IN")));
 assert.equal(json.pharmacies[1].state,"Sin información");
 assert.ok(queries.some(x=>x.sql.includes("fm_sync_ejecuciones")));
 assert.ok(queries.some(x=>x.sql.includes("fm_recepciones_cabeceras")));
});


test("cada hora: verde con éxito, rojo al fallar y rojo tras dos intervalos sin pulso",()=>{
 const now=new Date("2026-10-21T12:00:00Z");
 const base={jobId:"j1",flow:"ventas_completas",enabled:true,everyMinutes:60,
  registeredAt:"2026-10-21T08:00:00Z",heartbeatAt:"2026-10-21T11:59:00Z",
  lastAttemptAt:"2026-10-21T11:00:00Z",lastFinishedAt:"2026-10-21T11:01:00Z",
  lastSuccessAt:"2026-10-21T11:01:00Z",lastState:"ok",
  nextDueAt:"2026-10-21T12:01:00Z",currentState:"idle"};
 assert.equal(evaluateMonitor(base,now).health,"ok");
 assert.equal(evaluateMonitor({...base,lastState:"error",error:"VPN inaccesible"},now).health,"error");
 assert.equal(evaluateMonitor({...base,heartbeatAt:"2026-10-21T09:59:00Z"},now).health,"error");
 assert.equal(evaluateMonitor({...base,nextDueAt:"2026-10-21T10:59:00Z"},now).health,"error");
 assert.equal(evaluateMonitor({...base,nextDueAt:"2026-10-21T11:59:00Z"},now).health,"warning");
 assert.equal(evaluateMonitor({...base,enabled:false},now).health,"paused");
});

test("la falta de movimientos no convierte en error un sincronizador correcto",()=>{
 const now=new Date("2026-10-21T12:00:00Z");
 const pharmacy={id:"1",name:"Centro",active:true,sourceCode:"ABA"};
 const m={jobId:"j1",flow:"ventas",enabled:true,everyMinutes:60,
  heartbeatAt:"2026-10-21T11:59:00Z",lastState:"ok",
  lastAttemptAt:"2026-10-21T11:00:00Z",lastFinishedAt:"2026-10-21T11:00:01Z",
  nextDueAt:"2026-10-21T12:00:01Z"};
 const summary=pharmacySyncSummary(pharmacy,[],{ventas:{lastReceivedAt:"2026-10-01T00:00:00Z"}},now,[m]);
 assert.equal(summary.state,"Correcto");
 assert.equal(summary.monitored,true);
 assert.equal(summary.incidents.length,0);
});

test("sin información inicial de trabajos no debe dibujarse un estado verde ficticio",()=>{
 const m={flow:"compras",enabled:true,everyMinutes:60,heartbeatAt:"2026-10-21T12:00:00Z",
  registeredAt:"2026-10-21T11:40:00Z",lastState:"pending"};
 assert.equal(evaluateMonitor(m,new Date("2026-10-21T12:00:00Z")).health,"warning");
 assert.equal(evaluateMonitor({...m,registeredAt:"2026-10-21T08:00:00Z"},
  new Date("2026-10-21T12:00:00Z")).health,"error");
});
