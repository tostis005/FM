import test from "node:test";
import assert from "node:assert/strict";
import {pickBestLaboratory,mapLaboratoryOffers,readPlannerLaboratories} from "./purchasePlannerSuppliers.js";

test("PUC recomienda laboratorio más barato y conserva CN/farmacia concretos",()=>{
 const articles=[
  {groupKey:"DCPF:100",pharmacyId:"1",articleId:"111111"},
  {groupKey:"DCPF:100",pharmacyId:"1",articleId:"222222"},
  {groupKey:"DCPF:100",pharmacyId:"2",articleId:"111111"}
 ];
 const rows=[
  {pharmacyId:"1",articleId:"111111",supplierCode:"LAB-A",supplierName:"Laboratorio A",puc:4.1,sampleLines:7},
  {pharmacyId:"1",articleId:"222222",supplierCode:"LAB-B",supplierName:"Laboratorio B",puc:3.5,sampleLines:6},
  {pharmacyId:"2",articleId:"111111",supplierCode:"LAB-A",supplierName:"Laboratorio A",puc:3.8,sampleLines:8}
 ];
 const result=mapLaboratoryOffers(rows,articles);
 assert.equal(result.byPharmacy.length,2);
 assert.equal(result.byPharmacy.find(x=>x.pharmacyId==="1").recommended.articleId,"222222");
 assert.equal(result.byPharmacy.find(x=>x.pharmacyId==="2").recommended.supplierCode,"LAB-A");
 assert.equal(result.recommendations[0].recommended.supplierName,"Laboratorio B");
 assert.equal(pickBestLaboratory([{puc:null},{supplierCode:"B",puc:5}]).supplierCode,"B");
 assert.equal(pickBestLaboratory([]),null);
});

test("SQL del PUC impide cooperativas, respeta los precios positivos y las farmacias autorizadas",async()=>{
 const calls=[];
 const pool={async query(q,values){
  calls.push({text:typeof q==="string"?q:q.text,values:values||q.values});
  if(calls.length===1)return {rows:[{pharmacyId:"1",articleId:"111111",
    supplierCode:"LAB-A",supplierName:"Laboratorio A",puc:2.8,sampleLines:4}]};
  return {rows:[{cn:"111111",dcpf:"100",nombre:"EFG",
   laboratorio:"Laboratorio A",laboratorio_codigo:"AAA"}]};
 }};
 const result=await readPlannerLaboratories(pool,
  {client:{slug:"ampedia",schema:"ampedia"}},
  [1],[{groupKey:"DCPF:100",pharmacyId:"1",articleId:"111111",cn:"111111"}],
  ["100"],"2026-10-21");
 assert.equal(result.recommendations[0].recommended.puc,2.8);
 assert.equal(result.presentations[0].laboratory,"Laboratorio A");
 assert.match(calls[0].text,/pm\.cooperativa IS NOT TRUE/);
 assert.match(calls[0].text,/pm\.ignorar_informes IS NOT TRUE/);
 assert.match(calls[0].text,/percentil|percentil,20/);
 assert.match(calls[0].text,/HAVING sum\(lines\)>=3/);
 assert.deepEqual(calls[0].values[1],[1]);
});
