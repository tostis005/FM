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

test("Cambiar código visible no cambia ID, código origen ERP ni nombre público",()=>{
 const base={id:"6",name:"Almacén central",sourceCode:"ALMACEN",
  displayCode:"ALM",sourceHost:"",sourceDatabase:"Farmatic"};
 const warehouse=decoratePharmacy("ampedia",base);
 assert.equal(warehouse.displayCode,"ALM");
 assert.equal(decoratePharmacy("ampedia",{id:"6",name:"Almacén",sourceCode:"ALMACEN"}).displayCode,"ALM");
 assert.equal(warehouse.sourceCode,"ALMACEN");
 assert.equal(warehouse.databaseCode,"ALMACEN");
 assert.equal(warehouse.name,"Almacén central");
 const customized=decoratePharmacy("ampedia",{
  id:"5",name:"Farmacia Plaza",sourceCode:"VAL",displayCode:"PLZ"
 });
 assert.equal(customized.displayCode,"PLZ");
 assert.equal(customized.databaseCode,"VAL");
 assert.equal(customized.name,"Farmacia Plaza");
});
