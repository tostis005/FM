import test from "node:test";
import assert from "node:assert/strict";
import {validTransferCustomerId,transferPreviewDates} from "./outgoingTransfers.js";

test("solo IDs de cliente ERP identificables y fechas reales en rango corto",()=>{
 for(const valid of ["1","42","99999999999"])
  assert.equal(validTransferCustomerId(valid),true);
 for(const invalid of ["","0","-1","1;DROP","Ana","123 456","0001","999999999999999999999"])
  assert.equal(validTransferCustomerId(invalid),false,invalid);
 assert.equal(transferPreviewDates("2026-09-01","2026-10-20"),true);
 assert.equal(transferPreviewDates("2026-01-01","2026-10-20"),false);
 assert.equal(transferPreviewDates("2026-02-30","2026-03-01"),false);
 assert.equal(transferPreviewDates("2026-10-20","2026-09-01"),false);
});
