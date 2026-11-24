import test from "node:test";
import assert from "node:assert/strict";
import {laboratorySavings} from "./salesLaboratoryModel.js";
test("one best alternative per CN; ties and missing prices",()=>{
 const t=(laboratory,cn,dcpf,net,generic=true)=>({laboratory,cn,dcpf,net,generic});
 const r=laboratorySavings({laboratory:"CINFA",products:[{reference:"1",cn:"1",dcpf:"A",generic:true,units:60,revenue:180},{reference:"1",cn:"1",dcpf:"A",generic:true,units:40,purchaseAmount:140},{reference:"2",cn:"2",dcpf:"B",generic:true,units:50},{reference:"3",cn:"3",dcpf:"A",generic:false,units:20}],tariffs:[t("Laboratorios Cinfa SA","1","A",2),t("NORMON","5","A",1),t("KERN","6","A",1),t("KERN","7","B",.1)]});
 assert.equal(r.summary.potentialSaving,100);assert.equal(r.summary.purchaseAmount,140);assert.equal(r.summary.salesUnits,170);assert.equal(r.destinations.length,1);assert.equal(r.destinations[0].key,"KERN");assert.equal(r.products.find(x=>x.cn==="2").saving,null);assert.equal(r.products.find(x=>x.cn==="3").saving,null);
});
test("missing sources never imply zero savings",()=>{const r=laboratorySavings({laboratory:"A",products:[{cn:"1",units:10}],tariffsAvailable:false,salesAvailable:false,purchasesAvailable:false});assert.equal(r.summary.revenue,null);assert.equal(r.summary.potentialSaving,null);assert.equal(r.summary.purchaseAmount,null);});

test("commercial totals include brand, para and products without tariffs; only comparable generics count toward savings",()=>{
 const r=laboratorySavings({laboratory:"CINFA",products:[
  {reference:"1",cn:"1",generic:true,dcpf:"A",units:10,revenue:30,purchaseUnits:9,purchaseAmount:18},
  {reference:"2",cn:"2",generic:false,units:5,revenue:50,purchaseUnits:4,purchaseAmount:32},
  {reference:"ERP:A:PARA",cn:null,generic:null,units:3,revenue:45,purchaseUnits:6,purchaseAmount:36}
 ],tariffs:[{laboratory:"CINFA",cn:"1",dcpf:"A",generic:true,net:2},{laboratory:"NORMON",cn:"4",dcpf:"A",generic:true,net:1}],direct:{units:20,amount:110}});
 assert.equal(r.summary.salesUnits,18);assert.equal(r.summary.revenue,125);assert.equal(r.summary.purchaseUnits,19);assert.equal(r.summary.purchaseAmount,86);
 assert.equal(r.summary.directAmount,110);assert.equal(r.summary.potentialSaving,10);assert.equal(r.summary.comparableProducts,1);assert.equal(r.products.length,3);
});

test("coverage denominator is generic units, not all commercial units",()=>{
 const r=laboratorySavings({laboratory:"CINFA",products:[{cn:"1",reference:"1",generic:true,dcpf:"A",units:10},{cn:"2",reference:"2",generic:false,units:90}],tariffs:[{laboratory:"CINFA",cn:"1",generic:true,dcpf:"A",net:2},{laboratory:"NORMON",cn:"3",generic:true,dcpf:"A",net:1}]});
 assert.equal(r.summary.salesUnits,100);assert.equal(r.summary.genericSoldProducts,1);assert.equal(r.summary.coverage,100);assert.equal(r.summary.potentialSaving,10);
});

test("commercial supplier name differs from tariff; exact CN origin and verified units restore savings",()=>{
 const r=laboratorySavings({laboratory:"Supplier name",supplierId:"9",products:[{reference:"1",cn:"1",dcpf:"A",generic:true,units:15,verifiedGenericUnits:10}],tariffs:[{laboratory:"LAB ONE",cn:"1",dcpf:"A",generic:true,net:2},{laboratory:"LAB TWO",cn:"2",dcpf:"A",generic:true,net:1}]});
 assert.equal(r.summary.salesUnits,15);assert.equal(r.summary.potentialSaving,10);assert.equal(r.destinations[0].units,10);
});
test("same CN and same supplier are never alternatives",()=>{
 const r=laboratorySavings({laboratory:"Supplier name",supplierId:"9",products:[{cn:"1",dcpf:"A",generic:true,units:10}],tariffs:[{laboratory:"Source",supplierId:"9",cn:"1",dcpf:"A",generic:true,net:2},{laboratory:"Alias",supplierId:"9",cn:"2",dcpf:"A",generic:true,net:.1},{laboratory:"Other",cn:"1",dcpf:"A",generic:true,net:.1},{laboratory:"Valid",cn:"3",dcpf:"A",generic:true,net:1}]});
 assert.equal(r.summary.potentialSaving,10);assert.equal(r.destinations[0].name,"Valid");
});

test("alternative tariff aliases belonging to the same manufacturer are excluded, other EFG of same DCPF are compared",()=>{
 const r=laboratorySavings({laboratory:"CINFA",supplierId:"1",products:[{cn:"123456",manufacturer:"Laboratorios Cinfa SA",dcpf:"A",generic:true,units:100,verifiedGenericUnits:100}],tariffs:[
 {laboratory:"CINFA",manufacturer:"Laboratorios Cinfa SA",supplierId:"1",cn:"123456",dcpf:"A",generic:true,net:2},
 {laboratory:"CANAL B",manufacturer:"CINFA",cn:"123457",dcpf:"A",generic:true,net:.1},
 {laboratory:"NORMON",manufacturer:"NORMON",cn:"123458",dcpf:"A",generic:true,net:1},
 {laboratory:"OTRO",cn:"123459",dcpf:"B",generic:true,net:.01},
 {laboratory:"MARCA",cn:"123460",dcpf:"A",generic:false,net:.01}]});
 assert.equal(r.summary.potentialSaving,100);assert.equal(r.destinations[0].name,"NORMON");
 assert.equal(r.summary.originTariffProducts,1);assert.equal(r.summary.alternativeTariffProducts,1);
});
