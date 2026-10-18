import test from "node:test";
import assert from "node:assert/strict";
import {decoratePharmacy,pharmacyDataCodeSQL} from "./pharmacyCodes.js";

test("Ampedia Valdemarías: código maestro visible POL, datos ERP VAL, nombre correcto",()=>{
 const p=decoratePharmacy("ampedia",{id:"5",name:"Valdemarías",sourceCode:"POL",active:true});
 assert.equal(p.sourceCode,"POL");
 assert.equal(p.displayCode,"POL");
 assert.equal(p.databaseCode,"VAL");
 assert.equal(p.name,"Valdemarías");
});
test("Otros clientes y farmacias conservan su propio código",()=>{
 assert.deepEqual(decoratePharmacy("otro-cliente",{id:"5",name:"Farmacia 5",sourceCode:"POL"}),{
  id:"5",name:"Farmacia 5",sourceCode:"POL",displayCode:"POL",databaseCode:"POL"});
 assert.equal(decoratePharmacy("ampedia",{id:"1",name:"Abadía",sourceCode:"ABA"}).databaseCode,"ABA");
});
test("SQL relaciona VAL exclusivamente en Ampedia farmacia 5 sin modificar DB",()=>{
 const sql=pharmacyDataCodeSQL("f");
 assert.match(sql,/cliente_slug='ampedia'/);
 assert.match(sql,/id=5/);
 assert.match(sql,/THEN 'VAL'/);
 assert.match(sql,/ELSE upper\(btrim\(f\.codigo_origen\)\)/);
 assert.throws(()=>pharmacyDataCodeSQL("f;DROP TABLE"),/Alias SQL inválido/);
});
