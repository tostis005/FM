import test from "node:test";
import assert from "node:assert/strict";
import {parsePromotionCNs,selectablePromotionProducts,mergePromotionSelection,promotionProductLabel,UNKNOWN_PRODUCT_NAME} from "./simuladorProductSelection.js";

test("pegar CN permite líneas, comas y espacios, mantiene ceros iniciales y evita duplicados",()=>{
 const list=parsePromotionCNs("194700\n168770,194700; 000123 \n");
 assert.deepEqual(list,{codes:["194700","168770","000123"],invalid:[]});
 assert.deepEqual(parsePromotionCNs("PO564 00022 194700"),{
  codes:["194700"],invalid:["PO564","00022"]
 });
});
test("la búsqueda de artículos solo ofrece filas con CN seleccionable",()=>{
 const results=selectablePromotionProducts([
  {cn:null,description:"EUCERIN CHAMPÚ",sourceId:"00022"},
  {cn:"194700",description:"Artículo real"},
  {cn:null,description:"PO564"},
  {cn:"168770",description:"Otro artículo"}
 ]);
 assert.deepEqual(results.products.map(x=>x.cn),["194700","168770"]);
 assert.equal(results.unavailableCount,2);
});
test("los CN pegados se seleccionan aunque no exista ficha local y no ocultan un nombre real",()=>{
 let list=mergePromotionSelection([],[{cn:"194700",description:"CN introducido"},
  {cn:"168770",description:"CN introducido"}]);
 assert.deepEqual(list.map(x=>x.cn),["194700","168770"]);
 list=mergePromotionSelection(list,[{cn:"194700",description:"Producto identificado"}]);
 assert.equal(list[0].description,"Producto identificado");
 list=mergePromotionSelection(list,[{cn:"194700",description:"CN introducido"}]);
 assert.equal(list[0].description,"Producto identificado");
 list=mergePromotionSelection(list,[{cn:null,description:"Sin CN"}]);
 assert.equal(list.length,2);
});

test("al pegar un CN mostrar CN - nombre real o indicar que no se conoce, nunca CN introducido",()=>{
 const raw=mergePromotionSelection([],[{cn:"194700",description:"CN introducido"},
  {cn:"168770",description:"Nombre no disponible"}]);
 assert.equal(raw[0].description,UNKNOWN_PRODUCT_NAME);
 assert.equal(promotionProductLabel(raw[0]),"194700 - Nombre no disponible");
 const named=mergePromotionSelection(raw,[{cn:"194700",description:"Champú Eucerin 250 ml"}]);
 assert.equal(promotionProductLabel(named[0]),"194700 - Champú Eucerin 250 ml");
 assert.equal(promotionProductLabel(named[1]),"168770 - Nombre no disponible");
 assert.equal(mergePromotionSelection(named,[{cn:"194700",description:null}])[0].description,
  "Champú Eucerin 250 ml");
});
