import test from "node:test";
import assert from "node:assert/strict";
import {reviewedSupplierVariants} from "./reviewedSupplierVariants.js";
test("only explicitly reviewed names with corroborating current alias evidence are eligible",()=>{
 const master=[{id:"1",name:"NOVARTS",class:"DIRECTO",active:true},{id:"2",name:"NOVARTIS",class:"DIRECTO",active:true},{id:"3",name:"ARAFARMA",class:"DIRECTO",active:true},{id:"4",name:"HRA PHARMA",class:"DIRECTO",active:true}];
 const aliases=[{supplier:"1",pharmacyCode:"ABA",sourceCode:"1"},{supplier:"2",pharmacyCode:"LUZ",sourceCode:"01"},{supplier:"3",pharmacyCode:"ABA",sourceCode:"2"},{supplier:"4",pharmacyCode:"LUZ",sourceCode:"2"}];
 assert.deepEqual(reviewedSupplierVariants(master,aliases).operations.map(o=>[o.from,o.to]),[["1","2"]]);
 assert.equal(reviewedSupplierVariants(master,aliases,new Set(["1"])).operations.length,0);
 assert.equal(reviewedSupplierVariants(master,aliases,new Set(),new Set(["2"])).operations.length,0);
 assert.equal(reviewedSupplierVariants(master,aliases.map(a=>({...a,pharmacyCode:"ABA"}))).operations.length,0);
 assert.equal(reviewedSupplierVariants(master,aliases.filter(a=>a.supplier!=="2")).operations.length,0);
});
