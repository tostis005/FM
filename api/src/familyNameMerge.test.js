import test from "node:test";
import assert from "node:assert/strict";
import {consolidateFamiliesByName,consolidateFamilyNamesUntilStable} from "./familyNameMerge.js";
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

test("la unificación converge al descubrir nuevos destinos después de fusionar",async()=>{
 const steps=[
  {activeFamilies:669,uniqueFamilies:317,ambiguousCrossSegment:125,
   actions:Array.from({length:352},(_,i)=>({sourceId:String(i+1000)})),
   groups:[],merged:352,aliasesMoved:354,articlesMoved:5485,stockRulesMoved:0},
  {activeFamilies:317,uniqueFamilies:313,ambiguousCrossSegment:51,
   actions:[{sourceId:"934"},{sourceId:"1039"},{sourceId:"1315"},{sourceId:"1164"}],
   groups:[],merged:4,aliasesMoved:4,articlesMoved:60,stockRulesMoved:0},
  {activeFamilies:313,uniqueFamilies:313,ambiguousCrossSegment:50,
   actions:[],groups:[],merged:0,aliasesMoved:0,articlesMoved:0,stockRulesMoved:0}
 ];
 const result=await consolidateFamilyNamesUntilStable({},"ampedia",{
  execute:async()=>steps.shift()
 });
 assert.equal(result.activeFamilies,669);
 assert.equal(result.uniqueFamilies,313);
 assert.equal(result.merged,356);
 assert.equal(result.passes,3);
 assert.equal(result.actions.length,356);
 assert.equal(result.articlesMoved,5545);
});
test("si no converge se rechaza la transacción en vez de dejar duplicados",async()=>{
 await assert.rejects(()=>consolidateFamilyNamesUntilStable({},"ampedia",{
  maxPasses:2,execute:async()=>({
   activeFamilies:10,uniqueFamilies:9,ambiguousCrossSegment:0,
   actions:[{sourceId:"2"}],groups:[],merged:1,
   aliasesMoved:1,articlesMoved:1,stockRulesMoved:0
  })
 }),/Quedan duplicados/);
});

test("normaliza el nombre de una familia única aunque no haya ninguna fusión",async()=>{
 const statements=[];
 const db={async query(q,values){
  const sql=typeof q==="string"?q:q.text;
  statements.push(sql);
  if(sql.startsWith("SELECT id::text AS id,nombre AS name"))
   return {rows:[{id:"14",name:"BEBE",segment:"PARAFARMACIA",
    referencePharmacy:"ALMACEN",customName:false,active:true}]};
  if(sql.startsWith("SELECT familia_id::text AS id,nombre_origen"))
   return {rows:[{id:"14",name:"Bebé"}]};
  if(sql.startsWith("SELECT familia_id::text AS id,count"))
   return {rows:[{id:"14",linked:20,para:20,med:0}]};
  if(sql.startsWith("SELECT g.id::text AS id FROM"))return {rows:[]};
  if(sql.startsWith("UPDATE farmetrica.familias_globales g SET nombre=m.name"))
   return {rowCount:1};
  return {rows:[],rowCount:0};
 }};
 const dry=await consolidateFamiliesByName(db,"ampedia",{dryRun:true});
 assert.equal(dry.actions.length,0);
 assert.equal(dry.renamesSuggested,1);
 assert.equal(dry.namesUpdated,0);
 assert.ok(statements.every(s=>s.trim().startsWith("SELECT")));
 statements.length=0;
 const applied=await consolidateFamiliesByName(db,"ampedia");
 assert.equal(applied.merged,0);
 assert.equal(applied.namesUpdated,1);
 const update=statements.find(x=>x.startsWith("UPDATE farmetrica.familias_globales g SET nombre=m.name"));
 assert.ok(update);
 assert.ok(update.includes("NOT g.nombre_manual"));
});
test("conserva el formato del nombre que haya personalizado el usuario",async()=>{
 const statements=[];
 const db={async query(q){
  const sql=typeof q==="string"?q:q.text;
  statements.push(sql);
  if(sql.startsWith("SELECT id::text AS id,nombre AS name"))
   return {rows:[{id:"14",name:"BEBE",segment:"PARAFARMACIA",
    referencePharmacy:"ALMACEN",customName:true,active:true}]};
  if(sql.startsWith("SELECT familia_id::text AS id,nombre_origen"))
   return {rows:[{id:"14",name:"Bebé"}]};
  return {rows:[],rowCount:0};
 }};
 const result=await consolidateFamiliesByName(db,"ampedia");
 assert.equal(result.renamesSuggested,0);
 assert.equal(result.namesUpdated,0);
 assert.ok(statements.every(x=>x.trim().startsWith("SELECT")));
});
