import test from "node:test";
import assert from "node:assert/strict";
import {resolvePromotionArticleKeys,articleKeysForCNs} from "./promocionesArticulos.js";

test("resuelve CN reales en origen Farmatic por farmacia, sin cruces",async()=>{
 const calls=[];
 const pool={async query(sql,params){
  calls.push({sql,params});
  if(sql.includes("to_regclass"))return {rows:[{present:true}]};
  return {rows:[
   {pharmacy_id:"1",cn:"123456",source_id:"11"},
   {pharmacy_id:"2",cn:"123456",source_id:"99"},
   {pharmacy_id:"2",cn:"654321",source_id:"11"},
  ]};
 }};
 const ctx={client:{schema:"ampedia",slug:"ampedia"},allowedPharmacyIds:[1,2]};
 const keys=await resolvePromotionArticleKeys(pool,ctx,["123456","654321"]);
 assert.deepEqual(articleKeysForCNs(keys,["123456"]),["1|11","2|99"]);
 assert.deepEqual(articleKeysForCNs(keys,["654321"]),["2|11"]);
 assert.deepEqual(calls[1].params,["ampedia",[1,2],["123456","654321"]]);
 assert.match(calls[1].sql,/f.id=ANY\(\$2::int\[\]\)/);
});
test("sin farmacias o CN no consulta el catálogo",async()=>{
 const pool={async query(){throw Error("No debe consultar PostgreSQL");}};
 const ctx={client:{schema:"ampedia",slug:"ampedia"},allowedPharmacyIds:[]};
 assert.deepEqual(await resolvePromotionArticleKeys(pool,ctx,["123456"]),[]);
 assert.deepEqual(await resolvePromotionArticleKeys(pool,{
  ...ctx,allowedPharmacyIds:[1]},["codigo-no-valido"]),[]);
});
test("rechaza esquemas que pudieran inyectar SQL",async()=>{
 await assert.rejects(resolvePromotionArticleKeys({},{
  client:{schema:"ampedia\";drop schema x;--",slug:"ampedia"},allowedPharmacyIds:[1]
 },["123456"]),/Cliente de promociones no autorizado/);
});
