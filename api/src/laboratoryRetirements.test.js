import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {automaticRetirementPrefixes,normalizedRetirementPattern,
 matchesRetirementRule,isRetiredProductName,retiredProductSQL} from "./laboratoryRetirements.js";

test("Las cadenas automáticas se buscan literalmente y no se confunde BAJA con *BAJA*",()=>{
 assert.deepEqual(automaticRetirementPrefixes,["ZZZ","*BAJA","* BAJA"]);
 for(const name of ["ZZZ Aspirina"," ZZZPRODUCTO","**BAJA Paracetamol",
  "* BAJA Producto","*** BAJA 002","zzzbaja antiguo","Jarabe *BAJA final"])
  assert.equal(isRetiredProductName(name),true,name);
 for(const name of ["Comprimidos baja concentración","Aspirina","ZZ Mineral",
  "Sonda vesical baja fricción","SONDA VESICAL BAJA FRICCIÓN",
  "Este artículo baja la tensión"])
  assert.equal(isRetiredProductName(name),false,name);
 assert.equal(isRetiredProductName("Ibuprofeno DESCATALOGADO",["DESCATALOGADO"]),true);
 assert.equal(isRetiredProductName("IBUPROFENO xyz",["DESCATALOGADO"]),false);
});
test("Los asteriscos no son comodines: cada regla exige TODOS sus caracteres",()=>{
 assert.equal(normalizedRetirementPattern("  descatalogado "), "DESCATALOGADO");
 assert.equal(normalizedRetirementPattern(" *baja* "), "*BAJA*");
 for(const name of ["Jarabe *BAJA* 10 ml","Jarabe *baja* 10 ml",
  "En desuso *BAJA*", "SONDA *BAJA* FRICCIÓN"]){
  assert.equal(matchesRetirementRule(name,"*BAJA*"),true,name);
 }
 for(const name of ["Jarabe baja 10 ml","Jarabe BAJA 10 ml","Jarabe *BAJA 10 ml",
  "Jarabe BAJA* 10 ml","Sonda vesical baja fricción"]){
  assert.equal(matchesRetirementRule(name,"*BAJA*"),false,name);
 }
 assert.equal(matchesRetirementRule("Sonda vesical baja fricción","baja"),true,
  "BAJA a secas solo excluye si se configura explícitamente");
 assert.equal(matchesRetirementRule("100% crema","100%"),true,
  "ni % ni * son patrones SQL");
 assert.equal(matchesRetirementRule("A_B","A_B"),true);
 assert.equal(normalizedRetirementPattern("**"),null);
 assert.equal(normalizedRetirementPattern("abc\nmal"),null);
 assert.equal(normalizedRetirementPattern(""),null);
});
test("SQL dinámico y snapshots usan exactamente cadenas literales, nunca regex para bajas",async()=>{
 const clause=retiredProductSQL("a.nombre");
 assert.match(clause,/ARRAY\['ZZZ','\*BAJA','\* BAJA'\]::text\[\]/);
 assert.match(clause,/unnest\(/);
 assert.match(clause,/\$8::text\[\]/);
 assert.match(clause,/position\(upper\(exclude.cadena\)/);
 assert.doesNotMatch(clause,/\s~\s|LIKE|SIMILAR/);
 for(const file of ["preparadorLastReceipt.sql","preparadorLastReceiptSnapshot.sql"]){
  const sql=await readFile(new URL("./"+file,import.meta.url),"utf8");
  assert.match(sql,/ARRAY\['ZZZ','\*BAJA','\* BAJA'\]::text\[\]/,file);
  assert.doesNotMatch(sql,/coalesce\((?:ar|l)\.nombre,''\)\)\s*~/,file);
  assert.doesNotMatch(sql,/LIKE '%BAJA%'/,file);
 }
});
