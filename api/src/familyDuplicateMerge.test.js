import test from "node:test";
import assert from "node:assert/strict";
import {groupFamilyDuplicates,scoreFamilyPair} from "./familyDuplicates.js";
import {validateApprovedFamilyPair} from "./familyDuplicateMerge.js";
const families=[
 {id:"21",name:"Dietoterápicos",segment:"SIN_DETERMINAR",referencePharmacy:null,customName:false},
 {id:"22",name:"Dietoterapicos",segment:"SIN_DETERMINAR",referencePharmacy:null,customName:false}
];
const cns=new Map([
 ["21",new Set(Array.from({length:20},(_,i)=>String(504000+i)))],
 ["22",new Set(Array.from({length:15},(_,i)=>String(504000+i)))]
]);
const pair=groupFamilyDuplicates(families,[])[0];
const score=scoreFamilyPair(pair,cns,new Map([["21",20],["22",15]]));
const approval={sourceId:score.sourceId,destinationId:score.destinationId,
 slug:"dietoterapicos",segment:"SIN_DETERMINAR",minimumShared:10};

test("aprueba variante de tilde con 15 CN iguales y nombre exacto",()=>{
 assert.equal(score.safe,true);
 assert.equal(validateApprovedFamilyPair(score,approval,[],cns),true);
});
test("no sobrescribe equivalencias corregidas manualmente",()=>{
 assert.throws(()=>validateApprovedFamilyPair(score,approval,
  [{familyId:score.sourceId,method:"manual"}],cns),/manualmente/);
});
test("lista explícita no permite destinos o segmentos modificados",()=>{
 assert.throws(()=>validateApprovedFamilyPair(score,{...approval,destinationId:"500"},
  [],cns),/insuficiente/);
 assert.throws(()=>validateApprovedFamilyPair(score,{...approval,segment:"PARAFARMACIA"},
  [],cns),/insuficiente/);
});
test("una familia mixta no es apta para la fusión",()=>{
 const mixed=new Map([["21",new Set([...cns.get("21"),"000101","000102","000103"])],
  ["22",cns.get("22")]]);
 assert.throws(()=>validateApprovedFamilyPair(score,approval,[],mixed),
  /productos de ambos segmentos/);
});
