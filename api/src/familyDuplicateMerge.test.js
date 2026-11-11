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

test("variante con tilde y 84% de CN iguales permite aprobación excepcional sin reclasificar",()=>{
 const local=[
  {id:"845",name:"Dietoterápicos",segment:"SIN_DETERMINAR",referencePharmacy:null,customName:false},
  {id:"1154",name:"Dietoterapicos",segment:"SIN_DETERMINAR",referencePharmacy:null,customName:false}
 ];
 const pair=groupFamilyDuplicates(local,[])[0];
 const shared=Array.from({length:103},(_,i)=>String(504000+i));
 const c1=new Set([...shared,...Array.from({length:20},(_,i)=>String(100000+i))]);
 const c2=new Set([...shared,...Array.from({length:181},(_,i)=>String(500000+i))]);
 const map=new Map([["845",c1],["1154",c2]]);
 const scored=scoreFamilyPair(pair,map,new Map([["845",123],["1154",284]]));
 assert.equal(scored.safe,false);
 assert.equal(validateApprovedFamilyPair(scored,{
  sourceId:"845",destinationId:"1154",slug:"dietoterapicos",
  segment:"SIN_DETERMINAR",minimumShared:100,allowMixedRange:true
 },[],map),true);
});
test("un destino de una fusión previamente auditada puede recibir otro origen validado",()=>{
 const previous=[
  {id:"1056",name:"Gafas",segment:"SIN_DETERMINAR",referencePharmacy:null,customName:false},
  {id:"1130",name:"Gafas",segment:"SIN_DETERMINAR",referencePharmacy:null,customName:true}
 ];
 const pair=groupFamilyDuplicates(previous,[])[0];
 const shared=Array.from({length:17},(_,i)=>String(501780+i));
 const map=new Map([["1056",new Set([...shared,"091603","500550","500551"])],
  ["1130",new Set([...shared,"501900","501901","501902","501903","501904"])]]);
 const score=scoreFamilyPair(pair,map,new Map([["1056",20],["1130",22]]));
 const approval={sourceId:"1056",destinationId:"1130",slug:"gafas",
  segment:"SIN_DETERMINAR",minimumShared:17,allowMixedRange:true};
 const previousManual=[{familyId:"1130",method:"manual"}];
 assert.throws(()=>validateApprovedFamilyPair(score,approval,previousManual,map),/manualmente/);
 assert.equal(validateApprovedFamilyPair(score,approval,previousManual,map,new Set(["1130"])),true);
});
