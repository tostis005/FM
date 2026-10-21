import test from "node:test";
import assert from "node:assert/strict";
import {pharmacySyncSummary,setupPharmacyState} from "./pharmacyState.js";

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
  if(sql.includes(".fm_sync_ejecuciones"))return {rows:[{code:"ABA",flow:"ventas",state:"completado",
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
 assert.equal(json.pharmacies[0].flows[0].flow,"ventas");
 assert.equal(json.pharmacies[1].state,"Sin información");
 assert.ok(queries.some(x=>x.sql.includes("fm_sync_ejecuciones")));
 assert.ok(queries.some(x=>x.sql.includes("fm_recepciones_cabeceras")));
});
