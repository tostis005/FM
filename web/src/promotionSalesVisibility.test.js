import test from "node:test";
import assert from "node:assert/strict";
import {includePromotionForSales,promotionSalesInterval,scopePromotionSales} from "./promotionSalesVisibility.js";
const d=s=>new Date(s+"T12:00:00Z");
const base={id:"P1",status:"Borrador",statusSource:"manual",cns:["123456","654321"],
 targets:{},start:"2026-11-01",end:"2026-11-30",durationMode:"dates"};
test("borrador con CN y fechas es consultable sin objetivos ni farmacia asignada",()=>{
 assert.equal(includePromotionForSales(base,{page:"promociones",from:"2026-11-01",to:"2026-11-30"}),true);
 assert.deepEqual(promotionSalesInterval(base,d("2026-11-07")),{start:"2026-11-01",end:"2026-11-30"});
 assert.deepEqual(scopePromotionSales(base,{"1":12,"2":9},"total"),{"1":12,"2":9});
 assert.deepEqual(scopePromotionSales(base,{"1":12,"2":9},"attributed"),{});
});
test("las metas filtran ventas atribuibles y totales a las farmacias participantes",()=>{
 const p={...base,targets:{"1":25}};
 assert.deepEqual(scopePromotionSales(p,{"1":13,"2":20},"attributed"),{"1":13});
 assert.deepEqual(scopePromotionSales(p,{"1":13,"2":20},"total"),{"1":13});
});
test("tras importar se consultan también las ventas de fechas ocultas por filtro mensual",()=>{
 assert.equal(includePromotionForSales({...base,start:"2026-10-01",end:"2026-10-31"},
  {page:"promociones",from:"2026-11-01",to:"2026-11-30",importIds:["P1"]}),true);
 assert.equal(includePromotionForSales({...base,start:"2026-10-01",end:"2026-10-31"},
  {page:"promociones",from:"2026-11-01",to:"2026-11-30"}),false);
});
test("en seguimiento no se pierden los borradores seleccionados por carecer de metas",()=>{
 assert.equal(includePromotionForSales(base,{page:"seguimiento-global",selectedIds:["P1"]}),true);
 assert.equal(includePromotionForSales(base,{page:"seguimiento-global",selectedIds:["P2"]}),false);
});
test("no consultar campañas sin CN/fechas coherentes; stock abierto llega hasta hoy",()=>{
 assert.equal(promotionSalesInterval({...base,cns:[]},d("2026-11-07")),null);
 assert.equal(promotionSalesInterval({...base,start:"",end:""},d("2026-11-07")),null);
 assert.deepEqual(promotionSalesInterval({...base,end:"",durationMode:"stock"},d("2026-11-07")),
  {start:"2026-11-01",end:"2026-11-07"});
});
