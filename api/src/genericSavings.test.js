import test from "node:test";
import assert from "node:assert/strict";
import {periodReference,savingByOffer} from "./genericSavings.js";

test("la referencia de PUC usa percentil bajo ponderado y solo compras reales suficientes",()=>{
 const history=periodReference({
  to:"2026-11-17",policy:{global:{percentile:20,months:6},overrides:[]},
  sales:[{pharmacyId:1,units:100,revenue:350}],
  purchases:[
   {pharmacyId:1,date:"2026-10-10",price:1.5,units:20,lines:1},
   {pharmacyId:1,date:"2026-10-15",price:2,units:30,lines:1},
   {pharmacyId:1,date:"2026-10-20",price:4,units:50,lines:1}
  ]
 });
 assert.equal(history.soldUnits,100);
 assert.equal(history.referenceUnits,100);
 assert.equal(history.referencePuc,1.5);
 assert.equal(history.observedPuc,2.9);
 assert.equal(savingByOffer(history,{net:1.2,puc:1.248},80),24);
 assert.equal(savingByOffer(history,{net:2.1,puc:2.184},80),0);
});
test("las políticas específicas por farmacia no mezclan percentiles y coberturas",()=>{
 const policy={global:{percentile:20,months:6},
  overrides:[{pharmacyId:2,percentile:50,months:3}]};
 const history=periodReference({to:"2026-11-17",policy,
  sales:[{pharmacyId:1,units:90,revenue:180},{pharmacyId:2,units:10,revenue:25}],
  purchases:[
   {pharmacyId:1,date:"2026-10-12",price:2,units:10,lines:1},
   {pharmacyId:1,date:"2026-10-18",price:3,units:40,lines:1},
   {pharmacyId:1,date:"2026-10-25",price:4,units:50,lines:1},
   {pharmacyId:2,date:"2026-10-14",price:4,units:10,lines:1},
   {pharmacyId:2,date:"2026-10-15",price:5,units:10,lines:1}
  ]});
 assert.equal(history.referenceUnits,90);
 assert.equal(history.pharmacies.find(x=>x.pharmacyId==="2").referencePuc,null);
 assert.equal(history.pharmacies.find(x=>x.pharmacyId==="2").percentile,50);
 assert.equal(savingByOffer(history,{net:1.5},80),72);
});
test("sin muestra de precio real no se inventa ahorro",()=>{
 const data=periodReference({to:"2026-11-17",
  sales:[{pharmacyId:1,units:150,revenue:300}],
  purchases:[{pharmacyId:1,date:"2026-11-01",price:2,units:15,lines:1}]});
 assert.equal(data.referencePuc,null);
 assert.equal(savingByOffer(data,{net:1},80),null);
});
