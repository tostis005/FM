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

test("Ventas por laboratorio y Genéricos comparten tarifa negociada y PUC histórico por farmacia",async()=>{
 const {laboratorySavings}=await import("./salesLaboratoryModel.js");
 const tariffs=[
  {cn:"111111",dcpf:"100",generic:true,laboratory:"LABORATORIOS ALFA SA",manufacturer:"ALFA",net:2},
  {cn:"111111",dcpf:"100",generic:true,laboratory:"Distribuidor",manufacturer:"ALFA",net:1.2},
  {cn:"222222",dcpf:"100",generic:true,laboratory:"BETA",manufacturer:"BETA",net:1}
 ];
 const sales=[{cn:"111111",dcpf:"100",laboratory:"ALFA",pharmacyId:1,units:100},
  {cn:"333333",dcpf:"100",laboratory:"ALFA",pharmacyId:1,units:40},
  {cn:"333333",dcpf:"100",laboratory:"ALFA",pharmacyId:2,units:60},
  {cn:"333333",dcpf:"100",laboratory:"ALFA",pharmacyId:3,units:20}];
 const references=new Map([["1|111111",{net:9,percentile:20,months:6}],["1|333333",{net:3,percentile:20,months:6}],["2|333333",{net:2,percentile:30,months:3}]]);
 const [g]=buildGenericOpportunities({tariffs,sales,references,salesAvailable:true,detail:true});
 const lab=laboratorySavings({laboratory:"ALFA",tariffs,references,products:[
  {cn:"111111",dcpf:"100",generic:true,manufacturer:"ALFA",units:100,genericSalesByPharmacy:{1:100}},
  {cn:"333333",dcpf:"100",generic:true,manufacturer:"ALFA",units:120,genericSalesByPharmacy:{1:40,2:60,3:20}}
 ]});
 const tariff=lab.products.find(p=>p.cn==="111111"),historical=lab.products.find(p=>p.cn==="333333");
 assert.equal(tariff.sourceNet,2);assert.equal(tariff.sourcePriceType,"tariff");
 assert.equal(tariff.saving,100);
 assert.equal(historical.sourceNet,2.4);assert.equal(historical.sourcePriceType,"history");
 assert.equal(historical.comparableUnits,100);assert.equal(historical.saving,140);
 assert.deepEqual(historical.sourcePercentiles,[20,30]);
 for(const row of lab.products)assert.equal(simulateOpportunity(g.sources.filter(s=>s.cn===row.cn),row.targetNet,100),row.saving);
 assert.equal(lab.summary.potentialSaving,240);
 assert.equal(lab.summary.comparableUnits,200);
});
