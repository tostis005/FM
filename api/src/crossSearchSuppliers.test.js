import test from "node:test";
import assert from "node:assert/strict";
import {displayCrossSupplierName,mergeCrossSupplierSources,
 resolveCrossSearchSuppliers} from "./crossSearchSuppliers.js";

test("no mostrar NO PROCEDE ni códigos internos como nombre de proveedor",()=>{
 for(const value of [null,"","NO PROCEDE"," No aplica ","A1234","B01234","N/A","—"])
  assert.equal(displayCrossSupplierName(value),null);
 assert.equal(displayCrossSupplierName(" Laboratorios CINFA "),"Laboratorios CINFA");
});

test("última recepción directa prevalece, proveedor habitual solo con identidad inequívoca",()=>{
 const rows=[{referencia:"400123",cn:"400123"},
  {referencia:"400124",cn:"400124"},{referencia:"400125",cn:"400125"},
  {referencia:"ERP:1:X12",cn:null}];
 const result=mergeCrossSupplierSources(rows,
  [{cn:"400123",proveedor:"LABORATORIO A"}],
  [{referencia:"400123",id:"5",proveedor:"OTRO LABORATORIO"},
   {referencia:"400124",id:"6",proveedor:"LABORATORIO B"},
   {referencia:"400125",id:"7",proveedor:"LABORATORIO C"},
   {referencia:"400125",id:"8",proveedor:"LABORATORIO D"},
   {referencia:"ERP:1:X12",id:"9",proveedor:"NO PROCEDE"}]);
 assert.deepEqual(result.map(r=>r.proveedor),["LABORATORIO A","LABORATORIO B",null,null]);
});

test("fallback consulta código de proveedor habitual de Farmatic y lo vincula con el maestro",async()=>{
 const queries=[];
 const pool={async query(q){
  queries.push(q);
  if(q.text.includes("FROM farmetrica.preparador_ultima_recepcion_cache cache"))
   return {rows:[]};
  if(q.text.includes("SELECT column_name")&&q.text.includes("information_schema.columns"))
   return {rows:[{column_name:"proveedor_habitual_id"}]};
  if(q.text.includes("SELECT EXISTS")&&q.text.includes("information_schema.columns"))
   return {rows:[{available:true}]};
  if(q.text.includes("WITH chosen AS MATERIALIZED"))return {rows:[
   {referencia:"400123",id:"3",proveedor:"CINFA"},
   {referencia:"ERP:1:INT123",id:"4",proveedor:"LABORATORIO ABC"}
  ]};
  throw Error("Consulta inesperada: "+q.text.slice(0,120));
 }};
 const found=await resolveCrossSearchSuppliers(pool,{
  client:{slug:"cliente_prueba",schema:"datos_prueba"}},{
  pharmacies:[1],rows:[{referencia:"400123",cn:"400123"},
   {referencia:"ERP:1:INT123",cn:null}]});
 assert.deepEqual(found.map(x=>x.proveedor),["CINFA","LABORATORIO ABC"]);
 const sql=queries.find(q=>q.text.includes("WITH chosen AS MATERIALIZED"));
 assert.match(sql.text,/proveedores_unificados_alias/);
 assert.match(sql.text,/a\.proveedor_habitual_id/);
 assert.match(sql.text,/p\.clase IN \('DIRECTO','VACUNAS','FÓRMULAS'\)/);
 assert.doesNotMatch(sql.text,/nomenclator_presentaciones/);
 assert.deepEqual(sql.values.slice(0,2),["cliente_prueba",[1]]);
});

test("si no existe asignación directa ni habitual se muestra guion, nunca nombre oficial",async()=>{
 const pool={async query(q){
  if(q.text.includes("FROM farmetrica.preparador_ultima_recepcion_cache cache"))
   return {rows:[]};
  if(q.text.includes("SELECT column_name"))return {rows:[]};
  if(q.text.includes("information_schema.columns"))return {rows:[{available:false}]};
  throw Error("Consulta inesperada");
 }};
 const result=await resolveCrossSearchSuppliers(pool,{
  client:{slug:"cliente_prueba",schema:"datos_prueba"}},{
   pharmacies:[1],rows:[{referencia:"400123",cn:"400123",nombre:"Medicamento"}]});
 assert.equal(result[0].proveedor,null);
});

test("una demo usa el último laboratorio del origen, pero el nombre de su propio selector",async()=>{
 const calls=[];
 const pool={async query(q,values){
  const request=typeof q==="string"?{text:q,values}:q;
  calls.push(request);
  if(request.text.includes("FROM farmetrica.clientes demo"))
   return {rows:[{sourceSlug:"origen",sourceSchema:"datos_origen",
    demoId:5,sourceId:15,code:"FAR1"}]};
  if(request.text.includes("FROM farmetrica.preparador_ultima_recepcion_cache cache"))
   return {rows:[{cn:"400123",proveedor:"Laboratorio de la demo"}]};
  throw Error("Consulta no esperada");
 }};
 const rows=await resolveCrossSearchSuppliers(pool,{
  client:{slug:"demo_uno",schema:"datos_demo",demo:true},
  pharmacies:[{id:5,name:"Farmacia de prueba"}]},{
  pharmacies:[5],rows:[{referencia:"400123",cn:"400123"}]});
 assert.equal(rows[0].proveedor,"Laboratorio de la demo");
 const snapshot=calls.find(q=>q.text.includes("FROM farmetrica.preparador_ultima_recepcion_cache cache"));
 assert.deepEqual(snapshot.values,["origen","demo_uno",[15],["400123"]]);
});
