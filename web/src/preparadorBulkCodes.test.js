import test from "node:test";
import assert from "node:assert/strict";
import {parseBulkCodes,parseDescriptionLines,preferredCNType} from "./preparadorBulkCodes.js";

test("se pegan 50 CN de una columna de Excel sin perder ceros iniciales",()=>{
 const input=Array.from({length:50},(_,i)=>String(123+i).padStart(6,"0")).join("\r\n")+"\r\n";
 const result=parseBulkCodes(input,"cn");
 assert.equal(result.codes.length,50);
 assert.equal(result.codes[0],"000123");
 assert.equal(result.codes.at(-1),"000172");
 assert.deepEqual(result.invalid,[]);
});
test("el pegado de Excel admite tabulaciones, punto y coma y duplicados",()=>{
 const result=parseBulkCodes("000123\t000124\r\n000124;000125","cn");
 assert.deepEqual(result.codes,["000123","000124","000125"]);
 assert.equal(result.duplicates,1);
});
test("EAN exige coincidencia completa de 8 a 14 dígitos, no fragmentos",()=>{
 const input=parseBulkCodes("8412345678901\n12345678\n840000000000000\nEAN-123","ean");
 assert.deepEqual(input.codes,["8412345678901","12345678","840000000000000","EAN-123"]);
 assert.deepEqual(input.invalid,["840000000000000","EAN-123"]);
});
test("las descripciones mantienen una frase por línea y las categorías homogéneas se reconocen",()=>{
 assert.deepEqual(parseDescriptionLines("paracetamol\nom eprazol\nparacetamol\n"),
  ["paracetamol","om eprazol"]);
 assert.equal(preferredCNType(["400123","700123"]),"medicacion");
 assert.equal(preferredCNType(["000123","300123"]),"parafarmacia");
 assert.equal(preferredCNType(["300123","400123"]),null);
});
