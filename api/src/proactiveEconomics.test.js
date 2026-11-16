import test from "node:test";
import assert from "node:assert/strict";
import {proactivePriceSQL,enrichProactivePrices,suggestedProactiveUnits} from "./proactiveEconomics.js";

test("ahorro potencial = unidades de reposición orientativa × diferencial de PUC",()=>{
 const row={articleId:"R1",alertType:"rotura",stock:10,units30:20};
 const purchases=[
  {articleId:"R1",channel:"cooperativa",units:4,price:12},
  {articleId:"R1",channel:"cooperativa",units:4,price:14},
  {articleId:"R1",channel:"laboratorio",units:2,price:9},
  {articleId:"R1",channel:"laboratorio",units:8,price:11}
 ];
 enrichProactivePrices([row],purchases,{percentile:20,months:6});
 assert.equal(row.suggestedUnits,10);
 assert.equal(row.targetPuc,9);
 assert.equal(row.cooperativePuc,13);
 assert.equal(row.savingPotential,40);
 assert.equal(row.priceEvidence.cooperativeLines,2);
});
test("sin comparables suficientes o sin datos no inventa euros",()=>{
 const row={articleId:"R2",alertType:"rotura",stock:3,units30:14};
 enrichProactivePrices([row],[{articleId:"R2",channel:"cooperativa",units:10,price:20},
 {articleId:"R2",channel:"laboratorio",units:10,price:12}],{percentile:20,months:6});
 assert.equal(row.suggestedUnits,11);
 assert.equal(row.savingPotential,null);
 assert.equal(row.targetPuc,null);
});
test("si la cooperativa es más barata, la oportunidad no puede ser negativa",()=>{
 const row={articleId:"R2",alertType:"rotura",stock:1,units30:11};
 enrichProactivePrices([row],[
  {articleId:"R2",channel:"cooperativa",units:1,price:8},
  {articleId:"R2",channel:"cooperativa",units:1,price:8},
  {articleId:"R2",channel:"laboratorio",units:1,price:10},
  {articleId:"R2",channel:"laboratorio",units:1,price:11}
 ],{percentile:20,months:6});
 assert.equal(row.savingPotential,0);
});
test("sin ventas de rotura no genera sugerencias de compra",()=>{
 assert.equal(suggestedProactiveUnits({alertType:"sin_ventas",stock:40,units30:0}),null);
 assert.equal(suggestedProactiveUnits({alertType:"rotura",stock:0,units30:0}),null);
});
test("SQL de precios exige catálogo y clasificación verificables sin escribir datos",()=>{
 const sql=proactivePriceSQL("ampedia");
 assert.match(sql,/proveedores_maestro/);
 assert.match(sql,/pm\.cooperativa IS TRUE/);
 assert.match(sql,/pm\.tipo/);
 assert.match(sql,/pm\.nombre/);
 assert.match(sql,/r\.articulo_id/);
 assert.doesNotMatch(sql,/\b(?:DELETE|INSERT|UPDATE)\b/i);
 assert.throws(()=>proactivePriceSQL("a; DROP SCHEMA a"));
});
