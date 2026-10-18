import test from "node:test";
import assert from "node:assert/strict";
import {sortGenericGroups} from "./genericGroupSort.js";
const groups=[
 {dcpf:"01",name:"Primero",revenue:200,skuCount:2,averagePuc:4,averagePvp:5,indicativeSavings:10},
 {dcpf:"02",name:"Segundo",revenue:500,skuCount:6,averagePuc:1,averagePvp:8,indicativeSavings:2},
 {dcpf:"03",name:"Sin precio",revenue:100,skuCount:4,averagePuc:null,averagePvp:2,indicativeSavings:null}
];
test("ordena TODOS los grupos antes del límite, no los primeros del ranking inicial",()=>{
 const base=sortGenericGroups(groups,"revenue","desc");
 assert.deepEqual(base.map(g=>g.dcpf),["02","01","03"]);
 assert.deepEqual(sortGenericGroups(base,"skuCount","asc").map(g=>g.dcpf),["01","03","02"]);
 assert.deepEqual(sortGenericGroups(base,"indicativeSavings","desc").map(g=>g.dcpf),["01","02","03"]);
 assert.deepEqual(sortGenericGroups(base,"unitMargin","desc").map(g=>g.dcpf),["02","01","03"]);
 assert.deepEqual(sortGenericGroups(base,"averagePuc","asc").map(g=>g.dcpf),["02","01","03"]);
 assert.deepEqual(base.map(g=>g.dcpf),["02","01","03"],"no modificar el orden original");
});
test("descarta claves y direcciones no permitidas",()=>{
 assert.throws(()=>sortGenericGroups(groups,"revenue;drop","desc"));
 assert.throws(()=>sortGenericGroups(groups,"revenue","sideways"));
});
