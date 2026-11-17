import test from "node:test";
import assert from "node:assert/strict";
import {applyGenericSalesSummary} from "./genericosVentasFast.js";

test("el catálogo oficial permanece aunque las ventas o compras fallen",()=>{
 const catalog=[{dcpf:"123",name:"Genérico 20 mg"},{dcpf:"456",name:"Genérico 40 mg"}];
 const without=applyGenericSalesSummary(catalog,{sales:[],purchases:[]});
 assert.equal(without[0].salesUnits,null);
 assert.equal(without[0].averagePuc,null);
 const withSales=applyGenericSalesSummary(catalog,
  {sales:[{dcpf:"123",units:12,revenue:90}],purchases:[]},
  {salesAvailable:true,purchasesAvailable:false});
 assert.equal(withSales[0].salesUnits,12);
 assert.equal(withSales[1].salesUnits,0);
 assert.equal(withSales[1].abcdClass,"D");
 assert.equal(withSales[0].averagePuc,null);
});
