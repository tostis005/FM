import test from "node:test";
import assert from "node:assert/strict";
import {laboratorySavings} from "./salesLaboratoryModel.js";
test("one best alternative per CN; ties and missing prices",()=>{
 const t=(laboratory,cn,dcpf,net,generic=true)=>({laboratory,cn,dcpf,net,generic});
 const r=laboratorySavings({laboratory:"CINFA",products:[{reference:"1",cn:"1",dcpf:"A",generic:true,units:60,revenue:180},{reference:"1",cn:"1",dcpf:"A",generic:true,units:40,purchaseAmount:140},{reference:"2",cn:"2",dcpf:"B",generic:true,units:50},{reference:"3",cn:"3",dcpf:"A",generic:false,units:20}],tariffs:[t("Laboratorios Cinfa SA","1","A",2),t("NORMON","5","A",1),t("KERN","6","A",1),t("KERN","7","B",.1)]});
 assert.equal(r.summary.potentialSaving,100);assert.equal(r.summary.purchaseAmount,140);assert.equal(r.summary.salesUnits,170);assert.equal(r.destinations.length,1);assert.equal(r.destinations[0].key,"KERN");assert.equal(r.products.find(x=>x.cn==="2").saving,null);assert.equal(r.products.find(x=>x.cn==="3").saving,null);
});
test("missing sources never imply zero savings",()=>{const r=laboratorySavings({laboratory:"A",products:[{cn:"1",units:10}],tariffsAvailable:false,salesAvailable:false,purchasesAvailable:false});assert.equal(r.summary.revenue,null);assert.equal(r.summary.potentialSaving,null);assert.equal(r.summary.purchaseAmount,null);});
