import test from "node:test";
import assert from "node:assert/strict";
import {mergeTicketActivity,mergeTicketFamilies} from "./salesTicketBreakdowns.js";

test("tickets por empleado y evolución se fusionan por identificador y período",()=>{
 const result=mergeTicketActivity([
  {sellers:[{pharmacyId:"1",sellerId:"10",tickets:2}],
   series:[{bucket:"2026-01",tickets:2}]},
  {sellers:[{pharmacyId:"1",sellerId:"10",tickets:4},
    {pharmacyId:"2",sellerId:"10",tickets:3}],
   series:[{bucket:"2026-02",tickets:7}]}
 ]);
 assert.equal(result.sellers.length,2);
 assert.equal(result.sellers.find(s=>s.pharmacyId==="1").tickets,6);
 assert.deepEqual(result.series,[{bucket:"2026-01",tickets:2},{bucket:"2026-02",tickets:7}]);
});
test("tickets por familia se acumulan sin confundirlos con unidades",()=>{
 assert.deepEqual(mergeTicketFamilies([{families:[{key:"dermocosmetica",tickets:5}]},
  {families:[{key:"dermocosmetica",tickets:4},{key:"sin clasificar",tickets:1}]}]),
 {families:[{key:"dermocosmetica",tickets:9},{key:"sin clasificar",tickets:1}]});
});
