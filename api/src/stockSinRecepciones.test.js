import test from "node:test";
import assert from "node:assert/strict";
import {buildStockSinRecepcionesSQL,stockSinRecepcionesFilters,
 validCutoff,setupStockSinRecepciones} from "./stockSinRecepciones.js";

const context={
 client:{slug:"ampedia",schema:"ampedia"},allowedPharmacyIds:[1,2],
 pharmacies:[{id:"1",sourceCode:"ABA"},{id:"2",sourceCode:"EUR"}]
};
const request=(query={})=>({context,query:{desde:"2024-10-26",...query}});
test("valida fecha real, hasta hoy y farmacias autorizadas",()=>{
 const now=new Date("2026-10-26T12:00:00Z");
 assert.equal(validCutoff("2024-02-29",now),true);
 assert.equal(validCutoff("2023-02-29",now),false);
 assert.equal(validCutoff("2026-10-27",now),false);
 assert.equal(validCutoff("2024-10-26",now),true);
 assert.deepEqual(stockSinRecepcionesFilters(request({farmacias:"2,2"})).ids,[2]);
 assert.throws(()=>stockSinRecepcionesFilters(request({farmacias:"3"})),e=>e.status===403);
 assert.throws(()=>stockSinRecepcionesFilters(request({farmacias:"1,foo"})),e=>e.status===400);
 assert.throws(()=>stockSinRecepcionesFilters(request({pagina:"0"})),e=>e.status===400);
 assert.throws(()=>stockSinRecepcionesFilters(request({tamano:"500"})),e=>e.status===400);
 assert.equal(stockSinRecepcionesFilters(request({tamano:"10"})).tamano,10);
 assert.throws(()=>stockSinRecepcionesFilters(request({orden:"1;DROP"})),e=>e.status===400);
 assert.throws(()=>stockSinRecepcionesFilters(request({direccion:"sideways"})),e=>e.status===400);
 assert.throws(()=>stockSinRecepcionesFilters(request({f_name:"x".repeat(101)})),e=>e.status===400);
 assert.equal(stockSinRecepcionesFilters(request({orden:"pvp",direccion:"asc",f_name:"paracetamol"})).filtros.name,"paracetamol");
});
test("SQL: aislamiento tenant/farmacia, stock real y anti-join de recepciones",()=>{
 assert.throws(()=>buildStockSinRecepcionesSQL('ampedia";DROP TABLE x;--'),/inválido/);
 const sql=buildStockSinRecepcionesSQL("ampedia");
 assert.match(sql,/FROM "ampedia"\.articulos a/);
 assert.match(sql,/f\.cliente_slug=\$3/);
 assert.match(sql,/f\.id=ANY\(\$2::int\[\]\)/);
 assert.match(sql,/a\.stock_actual>0/);
 assert.match(sql,/a\.pvp::float8 AS pvp/);
 assert.match(sql,/ORDER BY a\.stock_actual DESC NULLS LAST/);
 assert.match(buildStockSinRecepcionesSQL("ampedia","pvp","asc"),/ORDER BY a\.pvp ASC NULLS LAST/);
 assert.match(buildStockSinRecepcionesSQL("ampedia","name","asc"),/ORDER BY a\.nombre ASC NULLS LAST/);
 assert.match(buildStockSinRecepcionesSQL("ampedia","lastSaleAt","desc"),/ORDER BY \(SELECT sh\.fecha/);
 assert.throws(()=>buildStockSinRecepcionesSQL("ampedia","bad","asc"),/inválido/);
 assert.match(sql,/WITH recent AS MATERIALIZED/);
 assert.match(sql,/SELECT DISTINCT rl\.farmacia_codigo,rl\.articulo_origen_id/);
 assert.match(sql,/LEFT JOIN recent r ON r\.farmacia_codigo=a\.farmacia_codigo/);
 assert.match(sql,/AND r\.farmacia_codigo IS NULL/);
 assert.doesNotMatch(sql,/AND NOT EXISTS \(/);
 assert.match(sql,/rf\.cliente_slug=\$3/);
 assert.match(sql,/rf\.id=ANY\(\$2::int\[\]\)/);
 assert.match(sql,/rh\.fecha >= \$1::date/);
 assert.match(sql,/rl\.cantidad>0 AND coalesce\(rl\.devuelta,false\)=false/);
 assert.match(sql,/rh\.lineas_completas AND NOT rh\.eliminada_logicamente/);
 assert.doesNotMatch(sql,/rh\.eliminado_logicamente/);
 assert.match(sql,/sl\.cantidad>0 AND coalesce\(sl\.devuelta,false\)=false/);
 assert.ok(sql.indexOf("LIMIT $5::int OFFSET $6::int")<sql.indexOf("LEFT JOIN LATERAL"));
 assert.match(sql,/count\(\*\) OVER\(\)::int AS "totalCount"/);
});
test("API limita la página sin recuento global y no consulta nombres de otras farmacias",async()=>{
 const queries=[],rows=Array.from({length:26},(_,i)=>({
  pharmacyId:"1",pharmacyName:"Abadía",pharmacyCode:"ABA",
  sourceId:String(1000+i),cn:String(900000+i),name:"Artículo "+i,
  laboratory:"Lab",stock:10+i,pvp:9.95,totalCount:42,
  lastReceiptAt:null,lastSaleAt:null,supplierCode:null
 }));
 const columnsByTable={
  articulos:["farmacia_codigo","origen_id","codigo_nacional","nombre",
   "laboratorio","stock_actual","pvp","sincronizado_en"],
  fm_recepciones_lineas:["farmacia_codigo","sistema_origen","documento_id",
   "articulo_origen_id","eliminada_logicamente","cantidad","devuelta"],
  fm_recepciones_cabeceras:["farmacia_codigo","sistema_origen","documento_id",
   "fecha","proveedor_origen_id","lineas_completas","eliminada_logicamente","estado"],
  fm_ventas_lineas:["farmacia_codigo","sistema_origen","documento_id",
   "articulo_origen_id","eliminada_logicamente","anulada","cantidad","devuelta"],
  fm_ventas_cabeceras:["farmacia_codigo","sistema_origen","documento_id",
   "fecha","lineas_completas","eliminado_logicamente","estado"]
 };
 const columns=Object.entries(columnsByTable).flatMap(([table_name,names])=>
  names.map(column_name=>({table_name,column_name})));
 const db={async query(sql,values){
  queries.push({sql,values});
  if(typeof sql==="string"&&sql.includes("to_regclass"))
   return {rows:[{articulos:"ampedia.articulos",recepciones:"ampedia.fm_recepciones_lineas",
    cab_recepciones:"ampedia.fm_recepciones_cabeceras",ventas:"ampedia.fm_ventas_lineas",
    cab_ventas:"ampedia.fm_ventas_cabeceras"}]};
  if(typeof sql==="string"&&sql.includes("information_schema.columns"))
   return {rows:columns};
  if(typeof sql==="object"&&sql.text.includes("candidatos AS MATERIALIZED"))return {rows};
  throw Error("Consulta inesperada");
 }};
 let handler;
 setupStockSinRecepciones({get(path,...handlers){
  assert.equal(path,"/api/analytics/stock/sin-recepciones");
  handler=handlers.at(-1);
 }},db,{requireTenantModule:module=>{
  assert.equal(module,"stock");return [];
 }});
 const response={statusCode:200,status(n){this.statusCode=n;return this},
  json(body){this.body=body;return this}};
 await handler(request({tamano:"25",farmacias:"1"}),response,e=>{throw e;});
 assert.equal(response.statusCode,200);
 assert.equal(response.body.rows.length,25);
 assert.equal(response.body.hasMore,true);
 assert.equal(response.body.total,42);
 assert.equal(response.body.rows[0].pvp,9.95);
 assert.deepEqual(queries.at(-1).sql.values,["2024-10-26",[1],"ampedia","",26,0,"","","","",""]);
});

test("API informa si las líneas de documentos no tienen los campos necesarios",async()=>{
 let handler;
 const db={async query(sql){
  if(typeof sql==="string"&&sql.includes("to_regclass"))return {rows:[{
   articulos:"ampedia.articulos",recepciones:"ampedia.fm_recepciones_lineas",
   cab_recepciones:"ampedia.fm_recepciones_cabeceras",
   ventas:"ampedia.fm_ventas_lineas",cab_ventas:"ampedia.fm_ventas_cabeceras"
  }]};
  if(typeof sql==="string"&&sql.includes("information_schema.columns"))
   return {rows:[{table_name:"articulos",column_name:"farmacia_codigo"}]};
  throw Error("No se debe ejecutar SQL documental sin verificar las columnas");
 }};
 setupStockSinRecepciones({get(_path,...handlers){handler=handlers.at(-1);}},
  db,{requireTenantModule:()=>[]});
 const response={statusCode:200,status(n){this.statusCode=n;return this;},
  json(body){this.body=body;return this;}};
 await handler(request(),response,e=>{throw e;});
 assert.equal(response.statusCode,200);
 assert.equal(response.body.available,false);
 assert.match(response.body.message,/sincronización/i);
});

test("API traduce timeout de PostgreSQL a un error explicativo",async()=>{
 let handler;
 const db={async query(){throw Object.assign(new Error("canceling statement"),{code:"57014"});}};
 setupStockSinRecepciones({get(_path,...handlers){handler=handlers.at(-1);}},
  db,{requireTenantModule:()=>[]});
 const response={statusCode:200,status(n){this.statusCode=n;return this;},
  json(body){this.body=body;return this;}};
 await handler(request(),response,e=>{throw e;});
 assert.equal(response.statusCode,503);
 assert.match(response.body.error,/tardando demasiado/i);
});
