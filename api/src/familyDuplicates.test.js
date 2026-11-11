import test from "node:test";
import assert from "node:assert/strict";
import {dedupFamilySlug,groupFamilyDuplicates,scoreFamilyPair,planFamilyMerges} from "./familyDuplicates.js";

test("neutraliza tildes y mayúsculas sin confundir ñ con n",()=>{
 assert.equal(dedupFamilySlug("Higiénicos"),dedupFamilySlug("Higienicos"));
 assert.equal(dedupFamilySlug("2022 - DERMOCOSMÉTICA"),dedupFamilySlug("Dermocosmetica"));
 assert.notEqual(dedupFamilySlug("Año escolar"),dedupFamilySlug("Ano escolar"));
 assert.equal(dedupFamilySlug("Otros"),"");
 assert.equal(dedupFamilySlug("Familia 55"),"");
});
const families=[
 {id:"1",name:"Dermocosmética",segment:"PARAFARMACIA",referencePharmacy:"ALMACEN",customName:false},
 {id:"2",name:"Dermocosmetica",segment:"PARAFARMACIA",referencePharmacy:null,customName:false},
 {id:"3",name:"Dermocosmetica",segment:"MEDICACION",referencePharmacy:null,customName:false},
 {id:"4",name:"Dermocosmetica",segment:"PARAFARMACIA",referencePharmacy:null,customName:true},
 {id:"5",name:"Dermocosmetica",segment:"PARAFARMACIA",referencePharmacy:"ABA",customName:false}
];
const aliases=[
 {familyId:"1",sourceName:"Dermocosmetica",pharmacyCode:"ALMACEN"},
 {familyId:"2",sourceName:"2022 - Dermocosmética",pharmacyCode:"EUR"}];
test("propone solo duplicados dentro del mismo segmento",()=>{
 const pairs=groupFamilyDuplicates(families,aliases);
 assert.ok(pairs.some(p=>p.a==="1"&&p.b==="2"));
 assert.ok(!pairs.some(p=>p.a==="1"&&p.b==="3"));
});
test("requiere suficientes CN comunes para fusionar",()=>{
 const [pair]=groupFamilyDuplicates(families.slice(0,2),aliases);
 const sets=new Map([
  ["1",new Set(["000001","000002","000003","000004","000005"])],
  ["2",new Set(["000001","000002","000003","000010"])]]);
 const score=scoreFamilyPair(pair,sets,new Map([["1",5],["2",4]]));
 assert.equal(score.safe,true);
 assert.equal(score.shared,3);
 assert.equal(score.destinationId,"1");
 assert.equal(planFamilyMerges([score]).length,1);
 assert.equal(scoreFamilyPair(pair,new Map([["1",sets.get("1")],["2",new Set(["000010"])]),
  new Map()).safe,false);
});
test("preserva referencias diferentes y nombres corregidos manualmente",()=>{
 const pairs=groupFamilyDuplicates(families,aliases);
 const sets=new Map(families.map(f=>[f.id,new Set(["000001","000002","000003","000004"])]));
 const pairRefs=pairs.find(p=>p.a==="1"&&p.b==="5");
 const pairManual=pairs.find(p=>p.a==="1"&&p.b==="4");
 assert.equal(scoreFamilyPair(pairRefs,sets,new Map()).reason,"doble_referencia");
 assert.equal(scoreFamilyPair(pairManual,sets,new Map()).reason,"nombre_editado");
});
test("no fusiona la misma familia dos veces en una pasada",()=>{
 const pair=groupFamilyDuplicates(families.slice(0,2),aliases)[0];
 const sets=new Map([["1",new Set(["000001","000002","000003","000004"])],
  ["2",new Set(["000001","000002","000003","000004"])]]);
 const score=scoreFamilyPair(pair,sets,new Map());
 assert.equal(planFamilyMerges([score,score]).length,1);
});
