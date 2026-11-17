import test from "node:test";
import assert from "node:assert/strict";
import {combineGenericHistory,genericLabSalesUnits,genericForwardVolume} from "./genericSalesDetail.js";

const sales={salesAvailable:true,items:[{dcpf:"111",units:100,revenue:250,
 cns:[{cn:"659407",units:40},{cn:"663922",units:60}],
 pharmacies:[{pharmacyId:"1",units:70,revenue:170},{pharmacyId:"2",units:30,revenue:80}]}]};
const reference={salesAvailable:false,purchasesAvailable:true,
 policy:{global:{percentile:20},overrides:[]},
 pharmacies:[{pharmacyId:"1",referencePuc:1.6,percentile:20},
  {pharmacyId:"2",referencePuc:1.2,percentile:20}]};
test("ventas desglosadas llegan sin depender del PUC; precios se incorporan después",()=>{
 const first=combineGenericHistory(sales,null,[{id:1},{id:2}]);
 assert.equal(first.soldUnits,100);
 assert.equal(first.salesRevenue,250);
 assert.equal(first.purchasesAvailable,false);
 assert.equal(first.referencePuc,null);
 assert.equal(first.pharmacies[0].salesUnits,70);
 const merged=combineGenericHistory(sales,reference,[{id:1},{id:2}]);
 assert.equal(merged.referencePuc,1.48);
 assert.equal(merged.referenceUnits,100);
 assert.deepEqual(merged.pharmacies.map(x=>x.salesUnits),[70,30]);
 assert.equal(genericLabSalesUnits({options:[{cn:"659407"}]},merged),40);
 assert.equal(genericLabSalesUnits({options:[{cn:"663922"}]},merged),60);
 assert.equal(genericLabSalesUnits({options:[{cn:"659407"},{cn:"663922"}]},merged),100);
});
test("propuesta de 30 días desde ventas: no simula stock ni unidades no importadas",()=>{
 const current=combineGenericHistory(sales,null,[{id:1},{id:2}]);
 assert.equal(genericForwardVolume(current,"2026-01-01","2026-01-31"),97);
 assert.equal(genericForwardVolume(null,"2026-01-01","2026-01-31"),null);
 assert.equal(genericForwardVolume(current,"bad","2026-01-31"),null);
});
test("fallo de referencia no oculta el histórico ni asigna ahorro ficticio",()=>{
 const failed=combineGenericHistory(sales,{purchasesAvailable:false,warning:"PUC no disponible"},[]);
 assert.equal(failed.soldUnits,100);
 assert.equal(failed.purchasesAvailable,false);
 assert.equal(failed.referencePuc,null);
 assert.match(failed.warning,/PUC no disponible/);
});
