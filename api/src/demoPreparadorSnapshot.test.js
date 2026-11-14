import test from "node:test";
import assert from "node:assert/strict";
import {
 demoLaboratoryIdsFromSnapshot,
 demoSupplierCNFromSnapshot,
 demoAllLaboratoryCNFromSnapshot
} from "./demoPreparadorSnapshot.js";

const ctx={client:{slug:"demo_individual",schema:"demo_individual",demo:true},
 pharmacies:[{id:"42",name:"Farmacia Demo",databaseCode:"ABA",active:true}]};
function fakePool({ready=true}={}){
 const calls=[];
 const pool={query:async request=>{
  const text=typeof request==="string"?request:request.text;
  const values=request.values??[];
  calls.push({text,values});
  if(text.includes("FROM farmetrica.clientes demo"))return {rows:[{
   sourceSlug:"ampedia",sourceSchema:"ampedia",demoId:42,sourceId:1,code:"ABA"
  }]};
  if(text.includes("FROM farmetrica.preparador_ultima_recepcion_estado"))
   return {rows:ready?[{present:1}]:[]};
  if(text.includes("SELECT DISTINCT demo.id"))return {rows:[{lab_id:"9001"}]};
  if(text.includes("WHERE cache.cliente_slug=$1 AND demo.id=$3"))
   return {rows:[{cn:"654321",nombre:"Articulo",excluded:false}]};
  if(text.includes("SELECT demo.id::text AS lab_id"))
   return {rows:[{lab_id:"9001",cn:"654321",nombre:"Articulo",excluded:true}]};
  throw Error("Query inesperada: "+text);
 }};
 return {pool,calls};
}
test("selector de demo: IDs de farmacia/laboratorio distintos y cache del origen",async()=>{
 const {pool,calls}=fakePool();
 assert.deepEqual(await demoLaboratoryIdsFromSnapshot(pool,ctx,[42]),["9001"]);
 const sql=calls.at(-1);
 assert.deepEqual(sql.values,["ampedia","demo_individual",[1]]);
 assert.match(sql.text,/demo\.clave_unificada=origen\.clave_unificada/);
 assert.match(sql.text,/cache\.pharmacy_ids && \$3::int\[\]/);
});
test("detalle de laboratorio: filtra el origen por farmacia activa e ID propio",async()=>{
 const {pool,calls}=fakePool();
 const rows=await demoSupplierCNFromSnapshot(pool,ctx,[42],"9001");
 assert.deepEqual(rows,[{cn:"654321",nombre:"Articulo",excluded:false}]);
 assert.deepEqual(calls.at(-1).values,["ampedia","demo_individual","9001",[1]]);
 assert.match(calls.at(-1).text,/demo\.id=\$3::bigint/);
});
test("cobertura: exclusiones por farmacia original sin exponer otras farmacias",async()=>{
 const {pool,calls}=fakePool();
 const rows=await demoAllLaboratoryCNFromSnapshot(pool,ctx,[42]);
 assert.deepEqual(rows,[{lab_id:"9001",cn:"654321",nombre:"Articulo",excluded:true}]);
 assert.deepEqual(calls.at(-1).values,["ampedia","demo_individual",[1]]);
});
test("si no hay snapshot en origen no se inventa catálogo de pedidos",async()=>{
 const {pool}=fakePool({ready:false});
 assert.equal(await demoLaboratoryIdsFromSnapshot(pool,ctx,[42]),null);
 assert.equal(await demoSupplierCNFromSnapshot(pool,ctx,[42],"9001"),null);
});
