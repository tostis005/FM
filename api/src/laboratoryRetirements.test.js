import test from "node:test";
import assert from "node:assert/strict";
import {automaticRetirementPrefixes,normalizedRetirementPattern,
 isRetiredProductName,retiredProductSQL} from "./laboratoryRetirements.js";

test("prefijos conocidos de baja sin falsos positivos para descripciones normales",()=>{
 assert.deepEqual(automaticRetirementPrefixes,["ZZZ","*BAJA","* BAJA"]);
 for(const name of ["ZZZ Aspirina"," ZZZPRODUCTO","**BAJA Paracetamol",
  "* BAJA Producto","*** BAJA 002","zzzbaja antiguo"])
  assert.equal(isRetiredProductName(name),true,name);
 for(const name of ["Comprimidos baja concentración","Aspirina", "ZZ Mineral",
  "Este artículo baja la tensión"])
  assert.equal(isRetiredProductName(name),false,name);
 assert.equal(isRetiredProductName("Ibuprofeno DESCATALOGADO",["DESCATALOGADO"]),true);
 assert.equal(isRetiredProductName("IBUPROFENO xyz",["DESCATALOGADO"]),false);
});
test("reglas personalizadas son subcadenas literales; no regex",()=>{
 assert.equal(normalizedRetirementPattern("  descatalogado "), "DESCATALOGADO");
 assert.equal(normalizedRetirementPattern(" *baja* "), "*BAJA*");
 for(const name of ["Jarabe *BAJA* 10 ml","Jarabe *baja* 10 ml",
   "En desuso *BAJA*"].filter(Boolean))
  assert.equal(isRetiredProductName(name,["*BAJA*"]),true,name);
 for(const name of ["Jarabe baja 10 ml","Jarabe BAJA 10 ml","Jarabe *BAJA 10 ml",
   "Jarabe BAJA* 10 ml","Comprimidos baja concentración"])
  assert.equal(isRetiredProductName(name,["*BAJA*"]),false,name);
 assert.equal(normalizedRetirementPattern("**"),null);
 assert.equal(normalizedRetirementPattern("abc\nmal"),null);
 assert.equal(normalizedRetirementPattern(""),null);
 const clause=retiredProductSQL("a.nombre");
 assert.match(clause,/position\(upper\(exclude.cadena\)/);
 assert.match(clause,/unnest\(\$8::text\[\]\)/);
 assert.match(clause,/\[\*\]\+|\[\*\]\+/);
});
