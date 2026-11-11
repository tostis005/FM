import test from "node:test";
import assert from "node:assert/strict";
import {familyKey,cleanFamilyName,referenceKey,selectFamilyDestination} from "./familyMatching.js";

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
