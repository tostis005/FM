import test from "node:test";
import assert from "node:assert/strict";
import {completeWarehouseTicketNames,warehouseTicketDiscountSQL} from "./promotionWarehouseExport.js";
test("warehouse fallback uses confirmed CN, never another pharmacy's ERP ID",async()=>{
 const calls=[];
 const pool={query:async(sql,args)=>{calls.push({sql,args});return {rows:[{cn:"123456",name:"Nombre oficial"}]}}};
 const context={client:{slug:"ampedia",schema:"ampedia"},allowedPharmacyIds:[1,6]};
 const result=await completeWarehouseTicketNames(pool,context,[
  {pharmacyId:"6",cn:"ERP-1",sourceArticleId:"ERP-1"},
  {pharmacyId:"1",cn:"ERP-1",articleName:"Otro producto"},
  {pharmacyId:"8",cn:"123456"},
  {pharmacyId:"6",cn:"ERP-2",nationalCode:"654321",articleName:"Nombre local"}
 ],{warehouseIds:[6,8],cns:["123456","654321"],articleKeys:[{cn:"123456",key:"6|ERP-1"}]});
 assert.equal(result[0].nationalCode,"123456");assert.equal(result[0].description,"Nombre oficial");
 assert.equal(result[1].articleName,"Otro producto");assert.equal(result[2].description,undefined);
 assert.equal(result[3].articleName,"Nombre local");assert.deepEqual(calls[0].args,[["123456"]]);
});
test("discount recovery is warehouse-only, preserves explicit zero, excludes global discounts and unknown amounts",()=>{
 const sql=warehouseTicketDiscountSQL();
 assert.ok(sql.includes("WHEN v.descuento_linea IS NOT NULL THEN v.descuento_linea"));
 assert.ok(sql.includes("f.tipo_establecimiento='almacen'"));
 assert.ok(sql.includes("coalesce(v.descuento_operacion_documento,0)=0"));
 assert.ok(sql.includes("v.importe IS NOT NULL"));
 assert.ok(sql.includes("abs(v.importe)<=abs(v.precio_unitario*v.unidades)"));
});
