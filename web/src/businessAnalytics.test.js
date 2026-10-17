import test from "node:test";
import assert from "node:assert/strict";
import {buildDemoTables,normalizeTables,round,sum} from "./businessDemoData.js";
import {buildAnalysis} from "./businessAnalytics.js";
const pharmacies=[{id:"1",name:"Abadía"},{id:"2",name:"Europa"},{id:"3",name:"Buenavista"}];
const asOf=new Date("2026-10-17T12:00:00.000Z");
const demo=buildDemoTables(pharmacies,asOf);
const data=(extra={})=>buildAnalysis(demo,{allowedPharmacyIds:pharmacies.map(x=>x.id),period:6,...extra},asOf);
test("las cinco tablas se relacionan mediante farmacia, CN y proveedor",()=>{
 const cn=new Set(demo.articulos.map(x=>x.cn));
 const suppliers=new Set(demo.proveedores.map(x=>x.id));
 const ids=new Set(pharmacies.map(x=>x.id));
 assert.equal(demo.articulos.length,24);
 assert.equal(demo.proveedores.length,6);
 for(const r of [...demo.ventas,...demo.compras,...demo.stock]){
  assert.ok(cn.has(r.cn));assert.ok(ids.has(r.farmaciaId));
 }
 for(const r of demo.compras)assert.ok(suppliers.has(r.proveedorId));
 assert.equal(new Set(demo.ventas.map(v=>v.id)).size,demo.ventas.length);
});
test("dashboard y módulos concilian exactamente con los mismos movimientos",()=>{
 const a=data();
 assert.equal(a.kpis.ventas,round(sum(a.salesRows,"value")));
 assert.equal(a.kpis.compras,round(sum(a.buyRows,"value")));
 assert.equal(a.kpis.stock,round(sum(a.stockRows,"value")));
 assert.equal(a.kpis.potencialCompra,round(sum(a.buyRows,"potential")));
 assert.equal(a.kpis.margen,round(sum(a.profitRows,"margin")));
 assert.equal(a.kpis.reposicionCoste,round(sum(a.replenishmentRows,"needValue")));
 assert.equal(a.kpis.compraGenericos,round(sum(a.genericRows,"value")));
 assert.equal(a.kpis.ventas,round(sum(a.monthly,"ventas")));
 assert.equal(a.kpis.compras,round(sum(a.monthly,"compras")));
 assert.equal(a.supplierRows.reduce((x,r)=>x+r.value,0).toFixed(0),a.buyRows.reduce((x,r)=>x+r.value,0).toFixed(0));
});
test("multi-farmacia, familias, CN y periodo recalculan las cifras",()=>{
 const all=data(),one=data({pharmacyIds:["1"]}),two=data({pharmacyIds:["1","2"]});
 assert.ok(one.kpis.ventas>0&&one.kpis.ventas<two.kpis.ventas);
 assert.ok(two.kpis.ventas<all.kpis.ventas);
 assert.ok(data({families:["Genéricos"]}).kpis.ventas<all.kpis.ventas);
 assert.equal(data({search:"847112"}).salesRows.every(x=>x.cn==="847112"),true);
 assert.ok(data({period:3}).kpis.ventas<data({period:6}).kpis.ventas);
 const empty=buildAnalysis(demo,{allowedPharmacyIds:["99"]},asOf);
 assert.equal(empty.kpis.ventas,0);
 assert.equal(empty.stockRows.length,0);
});
test("el coste objetivo, el margen y el stock derivan de compras y ventas",()=>{
 const a=data(),row=a.buyRows[0],stockRow=a.stockRows.find(x=>x.value!=null),marginRow=a.profitRows[0];
 assert.ok(Math.abs(row.potential-round(Math.max(0,row.puc-row.target)*row.units))<=.10);
 assert.ok(Math.abs(stockRow.value-round(stockRow.units*stockRow.unitCost))<=.10);
 assert.ok(Math.abs(marginRow.margin-round(marginRow.value-marginRow.units*marginRow.purchaseCost))<=.10);
 assert.ok(a.kpis.coberturaCostes>0);
});
test("sin farmacias autorizadas no se generan operaciones",()=>{
 const empty=buildDemoTables([],asOf);
 assert.equal(empty.ventas.length,0);assert.equal(empty.compras.length,0);assert.equal(empty.stock.length,0);
});
test("normalización admite el mismo contrato en datos reales",()=>{
 const model=normalizeTables(demo);
 assert.deepEqual(model.articulos[0],demo.articulos[0]);
 assert.equal(buildAnalysis(model,{allowedPharmacyIds:["1"]},asOf).kpis.ventas,data({pharmacyIds:["1"]}).kpis.ventas);
});
