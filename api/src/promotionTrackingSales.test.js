import test from "node:test";
import assert from "node:assert/strict";
import {calculatePromotionTracking} from "./promotionTrackingSales.js";
const context={client:{schema:"ampedia",slug:"ampedia"},allowedPharmacyIds:[1,2]};
function fixture(){
 const calls=[];
 const pool={async query(sql,params){
  calls.push({sql,params});
  if(sql.includes("to_regclass"))return {rows:[{present:true,has_normal:true}]};
  if(sql.includes("SELECT DISTINCT f.id::text AS pharmacy_id"))return {rows:[
   {pharmacy_id:"1",cn:"123456",source_id:"ERP-1"},
   {pharmacy_id:"2",cn:"123456",source_id:"ERP-2"}
  ]};
  if(sql.includes("WITH ticket_units AS")){
   const bundle=params[3],hasBundle=params[5],stock=params[7];
   // CN con una sola unidad por ticket: 0 atribuible a 2x1, pero
   // cuatro unidades totales vendidas en el período.
   return {rows:[
    {farmacia_id:"1",unidades:stock||bundle===1&&hasBundle?4:0,unidades_totales:4},
    {farmacia_id:"2",unidades:stock||bundle===1&&hasBundle?3:0,unidades_totales:3}
   ]};
  }
  throw Error("SQL inesperada "+sql);
 }};
 return {pool,calls};
}
const campaign={id:"P1",type:"dos_por_uno",cns:["123456"],start:"2026-11-01",
 end:"2026-11-07",status:"Borrador",targets:{}};
test("borrador sin metas conserva unidades totales aunque no haya 2 en el mismo ticket",async()=>{
 const {pool,calls}=fixture();
 const result=await calculatePromotionTracking(pool,context,[campaign]);
 assert.deepEqual(result.totalSales.P1,{"1":4,"2":3});
 assert.deepEqual(result.sales.P1,{"1":0,"2":0});
 const query=calls.at(-1);
 assert.match(query.sql,/v\.fecha >= \$1::date AND v\.fecha < \(\$2::date \+ interval '1 day'\)/);
 assert.match(query.sql,/f\.id=ANY\(\$10::int\[\]\)/);
 assert.deepEqual(query.params.slice(0,3),["2026-11-01","2026-11-07",["123456"]]);
 assert.deepEqual(query.params[6],["1|ERP-1","2|ERP-2"]);
 assert.deepEqual(query.params.slice(-2),["ampedia",[1,2]]);
});
test("una oferta del 20% cuenta unidades sueltas aunque esté en borrador",async()=>{
 const {pool}=fixture();
 const promo={...campaign,id:"DRAFT",type:"descuento_porcentaje",discountPercent:20};
 const result=await calculatePromotionTracking(pool,context,[promo]);
 assert.deepEqual(result.sales.DRAFT,{"1":4,"2":3});
 assert.deepEqual(result.totalSales.DRAFT,{"1":4,"2":3});
});
test("incluir farmacia sin metas no exige que el documento tenga objetivos",async()=>{
 const {pool}=fixture();
 const [res1,res2]=await Promise.all([
  calculatePromotionTracking(pool,context,[campaign]),
  calculatePromotionTracking(pool,context,[{...campaign,id:"P2",targets:{"1":25}}])
 ]);
 assert.equal(res1.totalSales.P1["2"],3);
 assert.equal(res2.totalSales.P2["2"],3);
});
