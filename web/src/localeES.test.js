import test from "node:test";
import assert from "node:assert/strict";
import {euro,quantity,integer,decimal,percentage,dateES,dateTimeES} from "./localeES.js";

test("formato español: separador de miles, coma decimal y euros limitados a 2 decimales",()=>{
 assert.match(euro(1234567.8999),/1\.234\.567,90\s*€/u);
 assert.match(euro(5),/5,00\s*€/u);
 assert.match(euro(0),/0,00\s*€/u);
 assert.match(euro(12.34567),/12,35\s*€/u);
 assert.equal(quantity(1234.5),"1.235");
 assert.equal(quantity(18),"18");
 assert.equal(integer(1234567),"1.234.567");
 assert.equal(decimal(1234.56),"1.234,56");
 assert.equal(percentage(11.235),"11,24 %");
 assert.equal(euro(null),"—");
 assert.equal(quantity(undefined),"—");
});
test("fechas españolas: YYYY-MM-DD se transforma sin desplazarse por huso horario",()=>{
 assert.equal(dateES("2026-10-19"),"19/10/2026");
 assert.equal(dateES("2026-01-04T00:00:00.000Z"),"04/01/2026");
 assert.equal(dateES(""),"—");
 assert.match(dateTimeES("2026-10-19T10:00:00.000Z","Europe/Madrid"),/^19\/10\/2026,? 12:00$/);
});
