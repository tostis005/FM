import test from "node:test";
import assert from "node:assert/strict";
import {readCrossLaboratoryCatalog} from "./laboratoryCrossSearch.js";

test("la búsqueda por CN conserva el nombre y resuelve el proveedor del preparador",async()=>{
 const queries=[];
 const pool={async query(arg,values){
  const q=typeof arg==="string"?{text:arg,values}:arg;
  queries.push(q);
  if(q.text.includes("WITH pharmacies AS MATERIALIZED")){
   return {rows:[{
    referencia:"400123",cn:"400123",nombre:"ROSUVASTATINA 20 MG",
    tipo:"medicacion",pharmacyIds:"1",inMaster:true,inReceipts:false,
    inSales:false,inPurchases:false,provisional:false
   }]};
  }
  if(q.text.includes("SELECT cadena FROM farmetrica.preparador_exclusiones"))return {rows:[]};
  if(q.text.includes("information_schema.columns"))return {rows:[{available:false}]};
  if(q.text.includes("WITH canonical_pharmacy"))return {rows:[]};
  if(q.text.includes("FROM farmetrica.preparador_ultima_recepcion_cache cache")){
   return {rows:[{cn:"400123",proveedor:"LABORATORIO REAL"}]};
  }
  throw Error("Consulta no prevista: "+q.text.slice(0,80));
 }};
 const ctx={client:{slug:"tenant_test",schema:"datos_prueba"}};
 const result=await readCrossLaboratoryCatalog(pool,ctx,{
  pharmacies:[1],type:"medicacion",filters:{cns:["400123"],eans:[],descriptions:[]}
 });
 assert.equal(result.rows.length,1);
 assert.equal(result.rows[0].proveedor,"LABORATORIO REAL");
 assert.equal(result.rows[0].cn,"400123");
 assert.equal(result.rows[0].nombre,"ROSUVASTATINA 20 MG");
 const sql=queries[0].text;
 assert.doesNotMatch(sql,/n\.laboratorio/);
 assert.doesNotMatch(sql,/a\.laboratorio/);
 assert.match(sql,/SELECT referencia,cn,nombre,tipo,"pharmacyIds"/);
 assert.ok(queries.some(q=>q.text.includes("JOIN farmetrica.proveedores_unificados p")));
 assert.deepEqual(queries[0].values.slice(0,2),["tenant_test",[1]]);
});

test("si no hay proveedor de Farmatic, no reutiliza nombres del Nomenclátor",async()=>{
 const pool={async query(q){
  const sql=typeof q==="string"?q:q.text||"";
  if(sql.includes("WITH pharmacies AS MATERIALIZED"))
   return {rows:[{referencia:"400123",cn:"400123",nombre:"ARTÍCULO",tipo:"medicacion"}]};
  if(sql.includes("SELECT cadena FROM"))return {rows:[]};
  if(sql.includes("information_schema.columns"))return {rows:[{available:false}]};
  if(sql.includes("WITH canonical_pharmacy"))return {rows:[]};
  if(sql.includes("FROM farmetrica.preparador_ultima_recepcion_cache"))return {rows:[]};
  if(sql.includes("SELECT column_name"))return {rows:[]};
  throw Error("Consulta no prevista");
 }};
 const result=await readCrossLaboratoryCatalog(pool,
  {client:{slug:"tenant_test",schema:"datos_prueba"}},{
   pharmacies:[1],type:"medicacion",filters:{cns:["400123"],eans:[],descriptions:[]}
  });
 assert.equal(result.rows[0].proveedor,null);
});

test("la búsqueda transversal valida el esquema y no lee otros clientes",async()=>{
 let queries=0;
 const pool={async query(){queries++;return {rows:[]}}};
 await assert.rejects(()=>readCrossLaboratoryCatalog(pool,{
  client:{slug:"otro",schema:"invalid;DROP"}},{
   pharmacies:[1],type:"parafarmacia",
   filters:{cns:["123456"],eans:[],descriptions:[]}
  }),/Esquema o tipo no válido/);
 assert.equal(queries,0);
});
