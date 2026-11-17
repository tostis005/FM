import test from "node:test";
import assert from "node:assert/strict";
import {readCrossLaboratoryCatalog} from "./laboratoryCrossSearch.js";

test("el catálogo transversal devuelve proveedor real sin alterar CN, nombre ni métricas",async()=>{
 const queries=[];
 const pool={async query(arg,values){
  const q=typeof arg==="string"?{text:arg,values}:arg;
  queries.push(q);
  if(q.text.includes("WITH pharmacies AS MATERIALIZED")){
   return {rows:[{
    referencia:"400123",cn:"400123",nombre:"ROSUVASTATINA 20 MG",
    proveedor:"LABORATORIO DE PRUEBA",tipo:"medicacion",pharmacyIds:"1",
    inMaster:true,inReceipts:false,inSales:false,inPurchases:false,provisional:false
   }]};
  }
  if(q.text.includes("SELECT cadena FROM farmetrica.preparador_exclusiones"))
   return {rows:[]};
  if(q.text.includes("information_schema.columns"))
   return {rows:[{available:false}]};
  if(q.text.includes("WITH canonical_pharmacy"))
   return {rows:[]};
  throw Error("Consulta no prevista");
 }};
 const ctx={client:{slug:"tenant_test",schema:"datos_prueba"}};
 const result=await readCrossLaboratoryCatalog(pool,ctx,{
  pharmacies:[1],type:"medicacion",
  filters:{cns:["400123"],eans:[],descriptions:[]}
 });
 assert.equal(result.rows.length,1);
 assert.equal(result.rows[0].proveedor,"LABORATORIO DE PRUEBA");
 assert.equal(result.rows[0].cn,"400123");
 assert.equal(result.rows[0].nombre,"ROSUVASTATINA 20 MG");
 const sql=queries[0].text;
 assert.match(sql,/n\.laboratorio_comercializador/);
 assert.match(sql,/a\.laboratorio::text/);
 assert.match(sql,/array_agg\(proveedor ORDER BY source_priority,proveedor\)/);
 assert.match(sql,/SELECT referencia,cn,nombre,tipo,"pharmacyIds",proveedor/);
 assert.deepEqual(queries[0].values.slice(0,2),["tenant_test",[1]]);
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
