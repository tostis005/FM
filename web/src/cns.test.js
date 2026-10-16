import test from "node:test";
import assert from "node:assert/strict";
import {parseCNs,isValidCN,normalizeStoredCN,normalizeStoredCNs} from "./cns.js";

test("solo exactamente seis digitos, incluidos ceros iniciales", () => {
  assert.equal(isValidCN("000123"),true);
  for(const value of ["12345","1234567","123456.7"," 123456","12345A","123 456","١٢٣٤٥٦"]) {
    assert.equal(isValidCN(value),false,value);
  }
});
test("separadores permitidos y no duplicados",()=>{
  assert.deepEqual(parseCNs("000123, 184579\n184579; 999999"),["000123","184579","999999"]);
  assert.deepEqual(parseCNs("184579.6"),["184579.6"]); // Rechazado al guardar, no truncado de forma silenciosa
});
test("convertir solo antiguos CNs de demostracion",()=>{
  assert.equal(normalizeStoredCN("184579.6"),"184579");
  assert.equal(normalizeStoredCN("000123.4"),"000123");
  assert.equal(normalizeStoredCN("123456"),"123456");
  assert.equal(normalizeStoredCN("1234567"),null);
  assert.deepEqual(normalizeStoredCNs(["184579.6","184579","000123.4","abc"]),["184579","000123"]);
});
