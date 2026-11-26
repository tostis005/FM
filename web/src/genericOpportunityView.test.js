import test from "node:test";
import assert from "node:assert/strict";
import {simulateGenericOpportunity,rankOpportunityGroups,genericOriginBreakdown} from "./genericOpportunityView.js";
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

test("ahorro de cada CN hacia destino elegido, no ahorro hipotético de todo el conjunto",()=>{
 const rows=genericOriginBreakdown([
  {cn:"111111",laboratory:"ALFA",units:100,net:2,source:"tariff"},
  {cn:"333333",laboratory:"ALFA",units:40,net:3,source:"history",percentile:20,months:6},
  {cn:"333333",laboratory:"ALFA",units:60,net:2,source:"history",percentile:30,months:3},
  {cn:"333333",laboratory:"ALFA",units:20,net:null},
  {cn:"222222",laboratory:"BETA",units:50,net:1,source:"tariff"}
 ],1,80);
 assert.equal(rows.find(r=>r.cn==="111111").full,100);
 assert.equal(rows.find(r=>r.cn==="333333").full,140);
 assert.equal(rows.find(r=>r.cn==="333333").saving,112);
 assert.equal(rows.find(r=>r.cn==="333333").comparableUnits,100);
 assert.equal(rows.find(r=>r.cn==="222222").full,0);
 assert.equal(rows.reduce((n,r)=>n+r.saving,0),192);
});
