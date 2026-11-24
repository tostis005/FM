import test from "node:test";
import assert from "node:assert/strict";
import {buildGenericOpportunities,simulateOpportunity} from "./genericOpportunityModel.js";
test("tariff overrides historical price, sold CN without tariff uses scoped reference, excludes unsold catalogue rows",()=>{
 const [g]=buildGenericOpportunities({tariffs:[{dcpf:"1",cn:"11",laboratory:"A",net:2},{dcpf:"1",cn:"12",laboratory:"B",net:1}],
  sales:[{dcpf:"1",cn:"11",pharmacyId:"1",units:100,revenue:100,annual:120},{dcpf:"1",cn:"13",laboratory:"C",pharmacyId:"1",units:50,annual:50,revenue:50},{dcpf:"2",cn:"14",pharmacyId:"1",units:0,annual:0}],
  references:new Map([["1|11",{net:9,percentile:20}],["1|13",{net:3,percentile:20}]]),salesAvailable:true,detail:true});
 assert.equal(g.salesUnits,150);
 assert.equal(g.potentialSaving,200);
 assert.equal(g.historical.length,1);
 assert.equal(g.historical[0].net,3);
 assert.equal(simulateOpportunity(g.sources,1,20),40);
 assert.equal(simulateOpportunity(g.sources,3,20),-20);
 assert.equal(g.coverage,100);
});
test("no historical price remains unknown; no fabricated savings",()=>{
 const [g]=buildGenericOpportunities({sales:[{dcpf:"2",cn:"4",laboratory:"C",pharmacyId:"1",units:10,annual:10}],salesAvailable:true,detail:true});
 assert.equal(g.historical[0].net,null);
 assert.equal(g.potentialSaving,null);
 assert.equal(g.coverage,0);
 assert.equal(simulateOpportunity(g.sources,1,50),null);
});
