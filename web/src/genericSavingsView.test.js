import test from "node:test";
import assert from "node:assert/strict";
import {offerSaving,projectedSavings,savingsCoverage} from "./genericSavingsView.js";
import {mergeGenericSales,sortGenericRows} from "./genericosSalesMerge.js";

const history={salesAvailable:true,purchasesAvailable:true,soldUnits:100,referenceUnits:100,
 pharmacies:[{pharmacyId:"1",salesUnits:100,referencePuc:2}]};
test("elegir laboratorio y redirigir 80 % solo proyecta ese 80 %",()=>{
 const options=[
  {name:"NOR",percent:80,selected:{net:1.5,puc:1.56}},
  {name:"CINFA",percent:0,selected:{net:1.6,puc:1.664}}
 ];
 assert.equal(offerSaving(history,options[0].selected,80),40);
 assert.equal(projectedSavings(history,options),40);
 assert.equal(savingsCoverage(history),100);
});
test("sin precio observable el ahorro no se convierte en cero",()=>{
 assert.equal(offerSaving({...history,purchasesAvailable:false},{net:1},80),null);
 assert.equal(projectedSavings({...history,pharmacies:[]},
  [{percent:80,selected:{net:1}}]),null);
});
test("el análisis conserva todos los grupos aunque fallen las métricas",()=>{
 const catalog=[{dcpf:"1",name:"A"},{dcpf:"2",name:"B"}];
 const empty=mergeGenericSales(catalog,null);
 assert.equal(empty.groups.length,2);
 assert.equal(empty.groups[0].salesUnits,null);
 const data=mergeGenericSales(catalog,{salesAvailable:true,purchasesAvailable:false,
  sales:[{dcpf:"1",units:10,revenue:100}]});
 assert.equal(data.groups[0].salesUnits,10);
 assert.equal(data.groups[1].salesUnits,0);
 assert.equal(data.groups[1].abcdClass,"D");
 assert.deepEqual(sortGenericRows(data.groups,"revenue","desc").map(x=>x.dcpf),["1","2"]);
});
