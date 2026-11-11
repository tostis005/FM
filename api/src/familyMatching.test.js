import test from "node:test";
import assert from "node:assert/strict";
import {familyKey,cleanFamilyName,referenceKey,selectFamilyDestination,familyNameSlug,selectNamedDestination} from "./familyMatching.js";

test("limpia prefijos de año sin inventar un nombre inexistente",()=>{
 assert.equal(cleanFamilyName("2022 - DERMOCOSMETICA","37"),"Dermocosmética");
 assert.equal(cleanFamilyName("2022 / 2023 - SOLARES","71"),"Solares");
 assert.equal(cleanFamilyName("2022","37"),"Familia 37");
 assert.equal(cleanFamilyName("2022","02"),"Familia 02");
});
test("mantiene los códigos de familia locales y la prioridad de referencia",()=>{
 const refs=new Map([[familyKey("ALMACEN","27"),{key:referenceKey("PARAFARMACIA","27"),count:18}]]);
 const votes=new Map([[familyKey("EUR","27"),[{referencePharmacy:"ALMACEN",referenceCode:"27",count:9}]]]);
 assert.equal(selectFamilyDestination({pharmacyCode:"ALMACEN",code:"27"},votes,refs).method,"referencia");
 assert.equal(selectFamilyDestination({pharmacyCode:"EUR",code:"27"},votes,refs).method,"coincidencia_cn");
 assert.equal(selectFamilyDestination({pharmacyCode:"EUR",code:"28"},votes,refs).key,"LOCAL:EUR|28");
});
test("no fusiona familias con evidencia mixta o insuficiente",()=>{
 const refs=new Map([
  [familyKey("ALMACEN","1"),{key:"REF:PARAFARMACIA:1",count:10}],
  [familyKey("ABA","2"),{key:"REF:MEDICACION:2",count:10}]
 ]);
 const votes=new Map([
  [familyKey("EUR","4"),[{referencePharmacy:"ALMACEN",referenceCode:"1",count:6},{referencePharmacy:"ABA",referenceCode:"2",count:5}]],
  [familyKey("EUR","5"),[{referencePharmacy:"ALMACEN",referenceCode:"1",count:2}]]
 ]);
 assert.equal(selectFamilyDestination({pharmacyCode:"EUR",code:"4"},votes,refs).method,"sin_referencia");
 assert.equal(selectFamilyDestination({pharmacyCode:"EUR",code:"5"},votes,refs).method,"sin_referencia");
});


test("identifica etiquetas equivalentes sin usar el número de familia ERP",()=>{
 assert.equal(familyNameSlug("2022 - DERMOCOSMETICA","17"),"dermocosmetica");
 assert.equal(familyNameSlug("Dermocosmética","88"),"dermocosmetica");
 assert.equal(familyNameSlug("Otros","77"),"");
 const refs=new Map([[familyKey("ALMACEN","17"),
  {key:"REF:PARAFARMACIA:17",segment:"PARAFARMACIA"}]]);
 const names=new Map([["dermocosmetica",new Set(["REF:PARAFARMACIA:17"])]]);
 const shared=new Map();
 const decision=selectNamedDestination({pharmacyCode:"EUR",code:"51",
  name:"2022 - DERMOCOSMETICA",segment:"PARAFARMACIA"},names,shared,new Map(),refs);
 assert.equal(decision.key,"REF:PARAFARMACIA:17");
 assert.equal(decision.method,"coincidencia_nombre");
});
test("nombre común agrupa solo varias farmacias del mismo segmento",()=>{
 const shared=new Map([["solares|PARAFARMACIA",new Set(["EUR","ABA"])]]);
 const decision=selectNamedDestination({pharmacyCode:"EUR",code:"22",name:"Solares",
  segment:"PARAFARMACIA"},new Map(),shared,new Map(),new Map());
 assert.equal(decision.method,"nombre_compartido");
 assert.equal(decision.key,"NAME:PARAFARMACIA:solares");
 assert.equal(selectNamedDestination({pharmacyCode:"ABA",code:"22",name:"Solares",
  segment:"MEDICACION"},new Map(),shared,new Map(),new Map()).key,"NAME:MEDICACION:solares");
});
test("ambigüedad o referencias CN contradictorias impiden unificación por nombre",()=>{
 const refs=new Map([
  [familyKey("ALMACEN","10"),{key:"REF:PARAFARMACIA:10",segment:"PARAFARMACIA"}],
  [familyKey("ALMACEN","11"),{key:"REF:PARAFARMACIA:11",segment:"PARAFARMACIA"}]]);
 const names=new Map([["solares",new Set(["REF:PARAFARMACIA:10","REF:PARAFARMACIA:11"])]]);
 const shared=new Map([["solares|PARAFARMACIA",new Set(["EUR","ABA"])]]);
 assert.equal(selectNamedDestination({pharmacyCode:"EUR",code:"55",name:"Solares",
  segment:"PARAFARMACIA"},names,shared,new Map(),refs).key,"NAME:PARAFARMACIA:solares");
});

test("reconciliador y maestro admiten nombres cortos, tildes, signos y abreviaturas",()=>{
 assert.equal(familyNameSlug("o.t.c.","1"),familyNameSlug("OTC","22"));
 assert.equal(familyNameSlug("PIES","1"),familyNameSlug("Pies","7"));
 assert.equal(familyNameSlug("Familia: Dermo Cosmética","1"),
  familyNameSlug("2022 - Dermocosmetica","8"));
 assert.equal(familyNameSlug("Higiene/Cosmética Infanti","1"),
  familyNameSlug("Higiene y Cosmética Infantil","2"));
 assert.notEqual(familyNameSlug("Año","1"),familyNameSlug("Ano","1"));
 assert.equal(familyNameSlug("2022 - Otros","9"),"");
});
test("sin CN coincidentes dos farmacias reciben la misma familia provisional por nombre",()=>{
 const source={pharmacyCode:"ABA",code:"8",name:"PIES",segment:"SIN_DETERMINAR"};
 const other={...source,pharmacyCode:"EUR",code:"123",name:"Pies"};
 const a=selectNamedDestination(source,new Map(),new Map(),new Map(),new Map());
 const b=selectNamedDestination(other,new Map(),new Map(),new Map(),new Map());
 assert.equal(a.key,"NAME:SIN_DETERMINAR:pies");
 assert.equal(a.key,b.key);
});
test("no asignar una familia sin clasificar con medicamentos a parafarmacia por mera coincidencia de nombre",()=>{
 const ref={key:"REF:PARAFARMACIA:8",segment:"PARAFARMACIA"};
 const refs=new Map([[familyKey("ALMACEN","8"),ref]]);
 const names=new Map([["homeopatia",new Set([ref.key])]]);
 const a=selectNamedDestination({pharmacyCode:"EUR",code:"2",
  name:"Homeopatía",segment:"SIN_DETERMINAR",para:3,med:4},
  names,new Map(),new Map(),refs);
 assert.equal(a.key,"NAME:SIN_DETERMINAR:homeopatia");
});
