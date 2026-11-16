import test from "node:test";
import assert from "node:assert/strict";
import {orderUnits} from "./laboratoryOrderHistory.js";

test("suma unidades de parafarmacia sin mezclar farmacias",()=>{
 assert.equal(orderUnits([{units:5},{units:4}],"parafarmacia"),9);
});
test("suma líneas de medicación por farmacia",()=>{
 assert.equal(orderUnits([
  {unitsByPharmacy:{"1":2,"2":4}},
  {unitsByPharmacy:{"1":1,"2":3}}
 ],"medicacion"),10);
});
