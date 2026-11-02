import test from "node:test";
import assert from "node:assert/strict";
import {loadGenericArticleDetail} from "./genericArticleDetail.js";
const dcpf="10531000140107";
function fixture({legacy=false,allowed=[1]}={}){
 const calls=[];
 const product={cn:"654321",nombre:"Medicamento 20 mg 28 cápsulas",
  laboratorio:"Laboratorio A",laboratorio_codigo:"LAB",generico:true};
 const columns=[
  ...["farmacia_codigo","origen_id","codigo_nacional","sincronizado_en"].map(column_name=>({table_name:"articulos",column_name})),
  ...["id","cn"].map(column_name=>({table_name:"productos",column_name})),
  ...["farmacia_codigo","articulo_id","fecha","unidades","importe"].map(column_name=>({table_name:"fm_ventas_analitica",column_name})),
  ...["farmacia_codigo","articulo_id","fecha","unidades","importe","coste_unitario","proveedor_id","proveedor_nombre"].map(column_name=>({table_name:"fm_recepciones_analitica",column_name}))
 ];
 const pool={async query(input){
  assert.equal(typeof input,"object","La nueva ruta debe acotar cada consulta");
  calls.push(input);
  assert.ok(input.query_timeout<=10000,"Ninguna consulta bloquea indefinidamente");
  const sql=input.text;
  if(sql.includes("SELECT cn,nombre,laboratorio"))return {rows:[product]};
  if(sql.includes("information_schema.columns"))return {rows:columns};
  if(sql.includes("DISTINCT ON"))return {rows:[{code:"ABA",origen_id:"ERP9",cn:"654321"}]};
  if(sql.includes(".productos WHERE cn"))return {rows:[{origen_id:"ERP9",cn:"654321"}]};
  if(sql.includes(".fm_ventas_analitica"))return {rows:[
   {code:"ABA",articulo_id:"ERP9",units:7,revenue:35},
   {code:"OTRA",articulo_id:"ERP9",units:100,revenue:900}
  ]};
  if(sql.includes(".fm_recepciones_analitica"))return {rows:[
   {code:"ABA",articulo_id:"ERP9",units:4,spend:18,cost:16,priced_units:4,rows_count:2,amount_rows:2}
  ]};
  throw Error("Consulta inesperada: "+sql);
 }};
 const req={params:{dcpf},context:{client:{slug:"ampedia",schema:"ampedia"},
  allowedPharmacyIds:[1],pharmacies:[{id:"1",sourceCode:"ABA"},{id:"2",sourceCode:"OTRA"}]}};
 const res={status(n){this.statusCode=n;return this},json(x){this.body=x;return this}};
 const f={from:"2026-10-01",to:"2026-10-31",ids:allowed};
 return {pool,req,res,f,calls,legacy};
}
test("DCPF rápido consulta únicamente CN específicos y agrega ventas y compras",async()=>{
 const x=fixture();
 await loadGenericArticleDetail(x.pool,x.req,x.res,x.f);
 const result=x.res.body;
 assert.equal(result.view,"articles");
 assert.equal(result.products.length,1);
 assert.equal(result.products[0].cn,"654321");
 assert.equal(result.products[0].soldUnits,7,"No debe incluir otra farmacia");
 assert.equal(result.products[0].soldAmount,35);
 assert.equal(result.products[0].buyUnits,4);
 assert.equal(result.products[0].buyAmount,18);
 assert.equal(result.products[0].puc,4);
 assert.equal(x.calls.length,5);
 const queries=x.calls.map(c=>c.text).join("\n");
 assert.doesNotMatch(queries,/politica_precios|percentil|make_interval|referencePuc/i);
 assert.match(queries,/articulo_id=ANY\(\$4::text\[\]\)/);
 assert.ok(x.calls.every(c=>!c.text.includes("JOIN farmetrica.farmacias")),
  "El acceso debe depender solo de los códigos de farmacia ya autorizados");
});
test("desglose legado reutiliza el mapeo de CN sin políticas comerciales",async()=>{
 const x=fixture({legacy:true});
 await loadGenericArticleDetail(x.pool,x.req,x.res,x.f,{legacy:true});
 assert.equal(x.res.body.products[0].soldUnits,7);
 assert.equal(x.res.body.products[0].puc,4);
 assert.ok(x.calls.some(c=>c.text.includes(".productos WHERE cn")));
});
test("farmacias vacías no leen ventas de otros clientes",async()=>{
 const x=fixture({allowed:[]});
 await loadGenericArticleDetail(x.pool,x.req,x.res,x.f);
 assert.equal(x.calls.length,1);
 assert.equal(x.res.body.salesAvailable,false);
 assert.equal(x.res.body.products[0].soldUnits,0);
});
test("no acepta identificadores de DCPF ni esquemas arbitrarios",async()=>{
 const x=fixture();x.req.params.dcpf="10531;DROP";
 await loadGenericArticleDetail(x.pool,x.req,x.res,x.f);
 assert.equal(x.res.statusCode,400);
 assert.equal(x.calls.length,0);
});
