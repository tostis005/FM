import test from "node:test";
import assert from "node:assert/strict";
import {simulateGenericOpportunity,rankOpportunityGroups} from "./genericOpportunityView.js";
test("ranking occurs before pagination with unknown last",()=>{
 const rows=[{name:"a",abcdClass:"A",potentialSaving:null},{name:"b",abcdClass:"B",potentialSaving:500},{name:"c",abcdClass:"A",potentialSaving:30}];
 assert.deepEqual(rankOpportunityGroups(rows,"A").map(x=>x.name),["c","a"]);
 assert.deepEqual(rankOpportunityGroups(rows).map(x=>x.name),["b","c","a"]);
});
test("savings use eligible CN prices and can be negative",()=>{
 assert.equal(simulateGenericOpportunity([{net:2,units:100},{net:null,units:50}],1,20),20);
 assert.equal(simulateGenericOpportunity([{net:2,units:100}],3,20),-20);
 assert.equal(simulateGenericOpportunity([{net:null,units:100}],1,20),null);
});
