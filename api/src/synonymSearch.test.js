import test from "node:test";
import assert from "node:assert/strict";
import {isBarcodeSearch,synonymsReady,synonymMatchSQL,resolveEANReferences} from "./synonymSearch.js";
import {promotionCatalogSearchSQL} from "./promotionCatalogSearch.js";
import {buildStockSinRecepcionesSQL} from "./stockSinRecepciones.js";
import {buildSalesDetailSQL} from "./salesDetail.js";
import {readPurchasePlannerPaged} from "./purchasePlannerPaged.js";

const context={client:{slug:"ampedia",schema:"ampedia"},pharmacies:[{id:1}]};

test("EAN-8, UPC, EAN-13 y GTIN-14 conservan ceros a la izquierda",()=>{
 for(const code of ["01234567","012345678901","0842012301234","00842012301234"])
  assert.equal(isBarcodeSearch(code),true);
 for(const code of ["", "217800", "2178001", "843012345678901", "843-012-345","nombre"])
  assert.equal(isBarcodeSearch(code),false);
});

test("las búsquedas no consultan sinonimos para CN, texto ni tablas sin sincronizar",async()=>{
 let calls=0;
 const pool={async query(sql,params){
  calls++;
  assert.match(sql,/to_regclass/);
  assert.deepEqual(params,["ampedia.sinonimos"]);
  return {rows:[{available:false}]};
 }};
 assert.equal(await synonymsReady(pool,"ampedia","217800"),false);
 assert.equal(await synonymsReady(pool,"ampedia","CREMA"),false);
 assert.equal(calls,0);
 assert.equal(await synonymsReady(pool,"ampedia","0842012301234"),false);
 assert.equal(calls,1);
});

test("consulta exacta: sin convertir EAN ni mezclar artículos entre farmacias",()=>{
 const sql=synonymMatchSQL("ampedia",{
  pharmacy:"a.farmacia_codigo",article:"a.origen_id",term:"$3"});
 assert.match(sql,/FROM "ampedia"\.sinonimos syn/);
 assert.match(sql,/syn\.farmacia_codigo.*a\.farmacia_codigo/);
 assert.match(sql,/syn\.articulo_id.*a\.origen_id/);
 assert.match(sql,/syn\.codigo=\$3::text/);
 assert.doesNotMatch(sql,/sinonimos_maestro|::bigint|::integer/);
 assert.throws(()=>synonymMatchSQL("evil;drop",{pharmacy:"a.farmacia_codigo",article:"a.origen_id",term:"$3"}));
});

test("EAN se resuelve solo para farmacias autorizadas y conserva múltiples correspondencias",async()=>{
 const calls=[];
 const pool={async query(query,params){
  const sql=typeof query==="string"?query:query.text;
  const values=typeof query==="string"?params:query.values;
  calls.push({sql,values});
  if(sql.includes("to_regclass"))return {rows:[{available:true}]};
  return {rows:[
   {pharmacy_id:"1",article_id:"217800",cn:"194700"},
   {pharmacy_id:"1",article_id:"217801",cn:""},
   {pharmacy_id:"2",article_id:"000123",cn:"194701"}
  ]};
 }};
 const refs=await resolveEANReferences(pool,context,[1],"0842012301234");
 assert.deepEqual(refs,["194700","ERP:1:217800","ERP:1:217801","194701","000123","ERP:2:000123"]);
 assert.match(calls[1].sql,/f\.cliente_slug=\$1 AND f\.id=ANY\(\$2::int\[\]\)/);
 assert.match(calls[1].sql,/s\.codigo=\$3::text/);
 assert.match(calls[1].sql,/a\.origen_id::text.*s\.articulo_id/s);
 assert.deepEqual(calls[1].values,["ampedia",[1],"0842012301234"]);
});

test("promociones incluyen EAN solo si existe estructura sincronizada y mantienen CN",()=>{
 const fields=(table,columns)=>columns.map(column_name=>({table_name:table,column_name}));
 const articles=fields("articulos",["farmacia_codigo","origen_id","nombre","codigo_nacional"]);
 const withSynonyms=promotionCatalogSearchSQL("ampedia",[
  ...articles,...fields("sinonimos",["farmacia_codigo","articulo_id","codigo"])]);
 assert.ok(withSynonyms.byEAN);
 assert.match(withSynonyms.byEAN,/syn\.codigo=ANY\(\$3::text\[\]\)/);
 assert.match(withSynonyms.byEAN,/syn\.farmacia_codigo/);
 assert.match(withSynonyms.byEAN,/syn\.articulo_id/);
 assert.match(withSynonyms.byEAN,/f\.id=ANY\(\$2::int\[\]\)/);
 assert.match(withSynonyms.byCodes,/left\(btrim\(a\.codigo_nacional::text\),6\)/);
 assert.equal(promotionCatalogSearchSQL("ampedia",articles).byEAN,null);
});

test("existencias y ventas paginadas filtran EAN sin multiplicar movimientos",()=>{
 const stock=buildStockSinRecepcionesSQL("ampedia","stock","desc",{search:true,cn:true});
 assert.match(stock,/syn\.codigo=\$4::text/);
 assert.match(stock,/syn\.codigo=\$8::text/);
 assert.match(stock,/syn\.farmacia_codigo/);
 const sales=buildSalesDetailSQL("ampedia","value","desc",
  {articles:"normalized",purchases:"normalized"},{},true);
 assert.match(sales,/syn\.codigo=\$5::text/);
 assert.match(sales,/bool_or\("eanMatch"\) AS "eanMatch"/);
 assert.match(sales,/OR r\."eanMatch"/);
 assert.doesNotMatch(buildSalesDetailSQL("ampedia"),/syn\.codigo/);
});

test("preparador de compras filtra sus grupos por EAN y mantiene consulta sin sinonimos",async()=>{
 const statements=[];
 const pool={async query(query,params){
  const sql=typeof query==="string"?query:query.text;
  statements.push({sql,params:params||query.values});
  if(sql.includes("to_regclass"))return {rows:[{available:true}]};
  return {rows:[{groups:[],summary:{products:0}}]};
 }};
 await readPurchasePlannerPaged(pool,context,{
  from:"2026-11-01",to:"2026-11-10",chosen:[1],
  search:"0842012301234",columnFilters:{articleName:"00842012301234"}});
 const sql=statements.at(-1).sql;
 assert.match(sql,/syn\.codigo=\$5::text/);
 assert.match(sql,/syn\.codigo=\$8::text/);
 assert.match(sql,/syn\.farmacia_codigo/);
 assert.doesNotMatch(sql,/__EAN_(CATALOG|CLASSIFIED|COLUMN)__/);
 assert.deepEqual(statements.at(-1).params.slice(2,5),[[1],"ampedia","0842012301234"]);
});
