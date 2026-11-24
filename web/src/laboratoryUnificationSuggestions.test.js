import test from "node:test";
import assert from "node:assert/strict";
import {supplierMergeSuggestions} from "./laboratoryUnificationSuggestions.js";
test("one letter differences and punctuation are review-only, never transitive",()=>{
 const rows=[{id:"1",name:"ALMIRALL",class:"DIRECTO",origins:[{pharmacyCode:"A",sourceCode:"1"}]},{id:"2",name:"ALMIRAL",class:"DIRECTO",origins:[{pharmacyCode:"B",sourceCode:"01"}]},{id:"3",name:"ALMIRAL",class:"OTROS"}];
 const [r]=supplierMergeSuggestions(rows);assert.equal(r.verifiedByName,false);assert.deepEqual(r.matchingCodes,["1"]);assert.equal(r.count,2);assert.ok(r.names.includes("ALMIRALL"));
});
