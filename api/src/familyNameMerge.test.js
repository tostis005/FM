import test from "node:test";
import assert from "node:assert/strict";
import {consolidateFamiliesByName} from "./familyNameMerge.js";
function harness(){
 const queries=[];
 const db={async query(statement,values){
  const sql=typeof statement==="string"?statement:statement.text;
  const params=typeof statement==="string"?values:statement.values;
  queries.push({sql,params});
  if(sql.startsWith("SELECT id::text AS id,nombre AS name"))
   return {rows:[
    {id:"11",name:"Dermocosmética",segment:"PARAFARMACIA",
     referencePharmacy:"ALMACEN",customName:false,active:true},
    {id:"22",name:"DERMOCOSMETICA",segment:"PARAFARMACIA",
     referencePharmacy:null,customName:false,active:true}
   ]};
  if(sql.startsWith("SELECT familia_id::text AS id,nombre_origen"))
   return {rows:[{id:"11",name:"Dermocosmética"},{id:"22",name:"2022 - DERMOCOSMETICA"}]};
  if(sql.startsWith("SELECT familia_id::text AS id,count"))
   return {rows:[{id:"11",linked:100,para:100,med:0},
    {id:"22",linked:50,para:50,med:0}]};
  if(sql.startsWith("SELECT DISTINCT familia_destino::text AS id"))
   return {rows:[]};
  if(sql.startsWith("SELECT g.id::text AS id FROM"))
   return {rows:[{id:"11"},{id:"22"}]};
  if(sql.startsWith("UPDATE farmetrica.familias_globales_alias"))
   return {rowCount:1};
  if(sql.startsWith("UPDATE farmetrica.familias_globales_articulos"))
   return {rowCount:50};
  if(sql.startsWith("UPDATE farmetrica.familias_globales g SET activo=false"))
   return {rowCount:1};
  if(sql.startsWith("INSERT INTO farmetrica.transferidor_exposicion_familias"))
   return {rowCount:1};
  return {rowCount:0,rows:[]};
 }};
 return {db,queries};
}
test("simula unificar dos familias con CN distintos sin escribir nada",async()=>{
 const {db,queries}=harness();
 const summary=await consolidateFamiliesByName(db,"ampedia",{dryRun:true});
 assert.equal(summary.activeFamilies,2);
 assert.equal(summary.actions.length,1);
 assert.equal(summary.actions[0].destinationId,"11");
 assert.equal(summary.actions[0].sourceId,"22");
 assert.equal(summary.merged,0);
 assert.ok(queries.every(x=>x.sql.trim().startsWith("SELECT")));
});
test("reasigna artículos, alias y reservas de stock en bloque, conserva método local",async()=>{
 const {db,queries}=harness();
 const summary=await consolidateFamiliesByName(db,"ampedia");
 assert.equal(summary.merged,1);
 assert.equal(summary.articlesMoved,50);
 assert.equal(summary.aliasesMoved,1);
 assert.equal(summary.stockRulesMoved,1);
 const alias=queries.find(x=>x.sql.startsWith("UPDATE farmetrica.familias_globales_alias"));
 assert.ok(alias);
 assert.ok(!alias.sql.includes("metodo="),"no transformar equivalencias automáticas en manuales");
 assert.ok(queries.some(x=>x.sql.includes("fusionado_a=m.destination")));
 assert.ok(queries.some(x=>x.sql.includes("familias_globales_fusiones")));
});
test("ninguna actualización fuera del tenant solicitado",async()=>{
 const {db,queries}=harness();
 await consolidateFamiliesByName(db,"ampedia");
 assert.ok(queries.every(x=>x.params?.[0]==="ampedia"));
 await assert.rejects(()=>consolidateFamiliesByName(db,'ampedia"; DROP TABLE t;'),/Cliente inválido/);
});
