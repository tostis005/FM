import test from "node:test";
import assert from "node:assert/strict";
import {ADDITIONAL_LABORATORY_PAIRS,planAdditionalVerifiedLaboratoryAliases} from "./laboratoryAdditionalVerified.js";
const make=()=>{
 const master=new Map(),aliases=[];
 for(const [from,to,fromName,toName,cls,requireCode] of ADDITIONAL_LABORATORY_PAIRS){
  master.set(from,{id:from,name:fromName,class:"SIN_CLASIFICAR",active:true});
  master.set(to,{id:to,name:toName,class:cls,active:true});
  aliases.push({supplier:from,pharmacyCode:"SHOP"+from,sourceCode:requireCode?"CODE"+to:"OTHER"+from});
  if(!aliases.some(a=>a.supplier===to))aliases.push({supplier:to,pharmacyCode:"AMP",sourceCode:"CODE"+to});
 }
 return {master:[...master.values()],aliases};
};
test("17 relaciones revisadas con fabricantes farmacéuticos reales",()=>{
 const {master,aliases}=make(),r=planAdditionalVerifiedLaboratoryAliases(master,aliases);
 assert.equal(r.operations.length,17);assert.equal(r.review.length,0);
 assert.equal(new Set(r.operations.map(x=>x.from)).size,17);
 assert.ok(r.operations.every(x=>x.to&&x.from&&x.from!==x.to));
});
test("protección de manuales, histórico, código distinto y coexistencia por farmacia",()=>{
 const {master,aliases}=make();
 const p=planAdditionalVerifiedLaboratoryAliases(master,aliases,new Set(["1279"]),new Set(["305"]));
 assert.equal(p.review.filter(x=>x.reason==="asociacion_manual_o_pedido").length,7);
 const edited=aliases.map(a=>a.supplier==="1348"?{...a,sourceCode:"999"}:a);
 assert.ok(planAdditionalVerifiedLaboratoryAliases(master,edited).review.some(x=>x.from==="1348"&&x.reason==="codigo_erp_no_corroborado"));
 const overlap=aliases.map(a=>a.supplier==="1348"?{...a,pharmacyCode:"AMP"}:a);
 assert.ok(planAdditionalVerifiedLaboratoryAliases(master,overlap).review.some(x=>x.from==="1348"&&x.reason==="coexistencia_en_farmacia"));
});
test("las identidades tienen que mantenerse exactamente en el maestro",()=>{
 const {master,aliases}=make();master.find(x=>x.id==="1813").name="Aldo Unión otra compañía";
 assert.throws(()=>planAdditionalVerifiedLaboratoryAliases(master,aliases),/Cambió la identidad/);
});
