import {test} from "node:test";
import assert from "node:assert/strict";
import {nameArticleRows,nameTicketArticleRows} from "./articleNames.js";

test("CN auténtico y nombre se resuelven por farmacia sin convertir IDs ERP en CN",async()=>{
 const calls=[];
 const pool={async query(sql,params){
  calls.push({sql,params});
  if(sql.includes("information_schema.columns"))
   return {rows:["farmacia_codigo","origen_id","nombre","codigo_nacional","sincronizado_en"].map(column_name=>({column_name}))};
  return {rows:[
   {pharmacyId:"1",id:"123",cn:"654321",name:"Paracetamol marca A"},
   {pharmacyId:"2",id:"123",cn:null,name:"Artículo en farmacia 2"}
  ]};
 }};
 const context={client:{slug:"ci",schema:"ci_data"},allowedPharmacyIds:[1,2]};
 const result=await nameArticleRows(pool,context,[
  {pharmacyId:"1",articleId:"123"},
  {pharmacyId:"2",articleId:"123"},
  {pharmacyId:"1",articleId:"OTRO"},
  {pharmacyId:"3",articleId:"123"},
  {pharmacyId:"1",articleId:null}
 ]);
 assert.deepEqual(result.map(r=>[r.cn,r.articleName,r.articleId]),[
  ["654321","Paracetamol marca A","123"],
  [null,"Artículo en farmacia 2","123"],
  [null,null,"OTRO"],
  [null,null,"123"],
  [null,null,null]
 ]);
 assert.equal(calls.length,2,"Sólo dos consultas: columnas y catálogo agrupado");
 assert.deepEqual(calls[1].params[1],[1,2],"No consultar farmacias ajenas");
 assert.match(calls[1].sql,/f\.cliente_slug=\$1/);
 assert.match(calls[1].sql,/DISTINCT ON/);
});

test("si la fuente todavía no contiene CN se conserva nombre y referencia interna",async()=>{
 const pool={async query(sql){
  if(sql.includes("information_schema.columns"))
   return {rows:["farmacia_codigo","origen_id","nombre"].map(column_name=>({column_name}))};
  assert.match(sql,/NULL::text AS cn/);
  return {rows:[{pharmacyId:"1",id:"AB12",cn:null,name:"Producto importado"}]};
 }};
 const [result]=await nameArticleRows(pool,
  {client:{slug:"ci",schema:"ci_data"},allowedPharmacyIds:[1]},
  [{pharmacyId:"1",article:"AB12"}],{code:"article"});
 assert.equal(result.cn,null);
 assert.equal(result.articleName,"Producto importado");
 assert.equal(result.articleId,"AB12");
});

test("rechaza nombres de esquema inseguros",async()=>{
 await assert.rejects(nameArticleRows({query(){throw Error("No ejecutar")}},
  {client:{slug:"ci",schema:"bad;DROP"},allowedPharmacyIds:[1]},
  [{pharmacyId:"1",articleId:"A"}]),/no autorizado/);
});

test("tickets: conserva referencia ERP pero CN y nombre solo del catálogo autorizado",async()=>{
 const pool={async query(sql){
  if(sql.includes("information_schema.columns"))
   return {rows:["farmacia_codigo","origen_id","nombre","codigo_nacional"].map(column_name=>({column_name}))};
  return {rows:[{pharmacyId:"1",id:"789",cn:"123456",name:"Producto identificado"}]};
 }};
 const context={client:{slug:"ci",schema:"ci_data"},allowedPharmacyIds:[1]};
 const tickets=await nameTicketArticleRows(pool,context,[
  {pharmacyId:"1",cn:"789",ticket:"S1"},
  {pharmacyId:"1",cn:"999",ticket:"S2"},
  {pharmacyId:"2",cn:"789",ticket:"S3"}
 ]);
 assert.deepEqual(tickets.map(t=>[t.cn,t.sourceArticleId,t.nationalCode,t.articleName,t.description]),[
  ["789","789","123456","Producto identificado","Producto identificado"],
  ["999","999",null,null,null],
  ["789","789",null,null,null]
 ]);
});
