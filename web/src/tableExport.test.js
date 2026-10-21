import test from "node:test";
import assert from "node:assert/strict";
import {csvCell,tableCSV} from "./tableExport.js";

test("CSV conserva números negativos, comillas y acentos",()=>{
 const csv=tableCSV(["Farmacia","Unidades","Artículo"],[["Abadía",-2,'Crema "A"']]);
 assert.match(csv,/^\ufeff"Farmacia";"Unidades";"Artículo"/);
 assert.match(csv,/"Abadía";"-2";"Crema ""A"""/);
});
test("CSV protege de fórmulas y mantiene valores vacíos",()=>{
 assert.equal(csvCell("=2+2"),'"\'=2+2"');
 assert.equal(csvCell("-10"),'"-10"');
 assert.equal(csvCell(null),'""');
});
