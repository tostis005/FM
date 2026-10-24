import test from "node:test";
import assert from "node:assert/strict";
import {readDirectLaboratoryCatalog,diagnosticLaboratorySources} from "./laboratoryFastCatalog.js";
import {readLaboratoryOrderMatrix} from "./laboratoryOrderPlanner.js";

const ctx={client:{slug:"ampedia",schema:"ampedia"},pharmacies:[{id:1}]};
const opts={key:"N:CINFA",type:"medicacion",pharmacies:[1],
 from:"2026-10-01",to:"2026-10-24",page:1,size:40,search:""};
const catalogRow={referencia:"790321",cn:"790321",nombre:"Cinfa medicamento",
  tipo:"medicacion",inMaster:true,inReceipts:false,total:1};

test("catálogo directo no depende de ventas ni recepciones",async()=>{
 const calls=[];
 const pool={async query(q){
  calls.push(q);
  return {rows:[catalogRow]};
 }};
 const result=await readDirectLaboratoryCatalog(pool,ctx,opts);
 assert.equal(result.total,1);
 assert.equal(result.rows[0].cn,"790321");
 assert.match(calls[0].text,/nomenclator_presentaciones/);
 assert.match(calls[0].text,/articulos_laboratorio_maestro/);
 assert.match(calls[0].text,/ampedia.*articulos/);
 assert.doesNotMatch(calls[0].text,/fm_recepciones_analitica/);
 assert.doesNotMatch(calls[0].text,/fm_ventas_analitica/);
 assert.deepEqual(calls[0].values,["N:CINFA",[1],"ampedia","medicacion","",40,0]);
});
test("error de ventas/stock nunca oculta productos AEMPS",async()=>{
 let calls=0;
 const pool={async query(q){
  calls++;
  if(q.text.includes("fm_recepciones_analitica"))return {rows:[catalogRow]};
  if(q.text.includes("fm_ventas_analitica"))throw Object.assign(Error("Stock unavailable"),{code:"42703"});
  throw Error("unexpected SQL");
 }};
 const result=await readLaboratoryOrderMatrix(pool,ctx,opts);
 assert.equal(calls,2);
 assert.equal(result.total,1);
 assert.equal(result.rows[0].cn,"790321");
 assert.equal(result.metricsUnavailable,true);
 assert.match(result.warning,/Se han recuperado los artículos/);
 assert.equal(result.rows[0].totalSold,null);
});
test("la ausencia de farmacias no impide mostrar el catálogo de AEMPS",async()=>{
 const pool={async query(q){
  if(q.text.includes("fm_recepciones_analitica"))return {rows:[catalogRow]};
  throw Error("Should not query metrics");
 }};
 const result=await readLaboratoryOrderMatrix(pool,ctx,{...opts,pharmacies:[]});
 assert.equal(result.total,1);
 assert.match(result.warning,/No hay farmacias/);
 assert.equal(result.metricsUnavailable,true);
});
test("catálogo directo rescata referencias cuando el join de recepciones devuelve vacío",async()=>{
 const pool={async query(q){
  if(q.text.includes("fm_recepciones_analitica"))return {rows:[]};
  if(q.text.includes("WITH source AS"))return {rows:[catalogRow]};
  if(q.text.includes("fm_ventas_analitica"))return {rows:[]};
  throw Error("unexpected");
 }};
 const result=await readLaboratoryOrderMatrix(pool,ctx,opts);
 assert.equal(result.total,1);
 assert.equal(result.rows[0].cn,"790321");
 assert.match(result.warning,/recuperadas directamente/);
});
test("diagnóstico diferencia pestañas y evita inventar cifras ante fallo",async()=>{
 const pool={async query(q){
  if(q.values[3]==="medicacion")return {rows:[catalogRow]};
  return {rows:[]};
 }};
 const data=await diagnosticLaboratorySources(pool,ctx,opts);
 assert.equal(data.pharmacyCount,1);
 assert.deepEqual(data.sources,[
  {type:"medicacion",status:"ok",total:1},
  {type:"parafarmacia",status:"ok",total:0}
 ]);
});
