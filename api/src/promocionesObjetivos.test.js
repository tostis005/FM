import test from "node:test";
import assert from "node:assert/strict";
import {setupPromotionObjectives} from "./promocionesObjetivos.js";

function fixture({directRows,officialRows}={}){
 const routes=new Map(),queries=[];
 const pool={async query(input,values=[]){
  const sql=typeof input==="string"?input:input.text;
  const params=typeof input==="string"?values:input.values||[];
  queries.push({sql,params,timeout:input?.query_timeout});
  if(sql.includes("SELECT DISTINCT f.id::text AS pharmacy_id"))
   return {rows:[{pharmacy_id:"1",source_id:"ERP-123"}]};
  if(sql.includes("coalesce(sum(v.unidades)"))
   return {rows:[{pharmacy_id:"1",units:7,amount:53.8}]};
  if(sql.includes("SELECT table_name,column_name FROM information_schema.columns"))
   return {rows:[
    ...["farmacia_codigo","origen_id","nombre","codigo_nacional","cn_normalizado",
      "laboratorio","proveedor_habitual_id"].map(column_name=>({table_name:"articulos",column_name})),
    ...["farmacia_codigo","origen_id","nombre"]
      .map(column_name=>({table_name:"proveedores",column_name}))
   ]};
  if(sql.includes("WITH allowed AS MATERIALIZED"))
   return {rows:[{pharmacy_code:"ABA",supplier_code:"PR1",supplier_name:"Proveedor Ejemplo"}]};
  if(sql.includes("jsonb_to_recordset"))
   return {rows:[{pharmacy_id:"1",source_id:"ERP-123",description:"Artículo de prueba",
    national_code:"123456",normalized_code:null,laboratory:null,supplier_ref:"PR1",
    supplier_name:"Proveedor Ejemplo"}]};
  if(sql.includes("FROM \"ampedia\".articulos a JOIN farmetrica.farmacias"))
   return {rows:directRows??[{pharmacy_id:"1",source_id:"ERP-123",description:"Artículo de prueba",
    national_code:"123456",normalized_code:null,laboratory:null,supplier_ref:"PR1",
    supplier_name:null}]};
  if(sql.includes("SELECT cn::text AS cn,nombre::text AS description"))
   return {rows:officialRows||[]};
  if(sql.includes("nomenclator_presentaciones"))
   return {rows:[]};
  throw Error("Consulta SQL inesperada: "+sql);
 }};
 const app={post(path,...handlers){routes.set(path,handlers.at(-1));}};
 setupPromotionObjectives(app,pool,{requireTenantModule:()=>[]});
 async function call(path,body,scope=[1,2]){
  const req={body,context:{role:"gestor",client:{slug:"ampedia",schema:"ampedia"},
   allowedPharmacyIds:scope}};
  let status=200,response=null,error=null;
  const res={status(code){status=code;return res;},json(data){response=data;return res;}};
  await routes.get(path)(req,res,e=>{error=e;});
  if(error)throw error;
  return {status,response};
 }
 return {call,queries};
}
const periods=[{id:"october",from:"2026-10-01",to:"2026-10-31"}];
test("histórico por farmacia devuelve unidades e importe neto",async()=>{
 const api=fixture();
 const {status,response}=await api.call("/api/ventas/objetivos/historico",
   {cns:["123456"],pharmacyIds:[1],periods});
 assert.equal(status,200);
 assert.deepEqual(response.periods,{october:{"1":7}});
 assert.deepEqual(response.amounts,{october:{"1":53.8}});
 assert.deepEqual(api.queries[0].params,["ampedia",[1],["123456"]]);
 assert.deepEqual(api.queries[1].params,
   ["ampedia",[1],"2026-10-01","2026-10-31",["123456"],["1|ERP-123"]]);
 assert.match(api.queries[1].sql,/sum\(v.importe\)/);
});
test("prohíbe leer ventas de otras farmacias sin lanzar ninguna consulta",async()=>{
 const api=fixture();
 const out=await api.call("/api/ventas/objetivos/historico",
   {cns:["123456"],pharmacyIds:[2],periods},[1]);
 assert.equal(out.status,403);
 assert.equal(api.queries.length,0);
});
test("permite buscar por CN en el catálogo autorizado",async()=>{
 const api=fixture();
 const out=await api.call("/api/ventas/objetivos/buscar",{cns:["123456"],search:""});
 assert.equal(out.status,200);
 assert.deepEqual(out.response.products,[{cn:"123456",description:"Artículo de prueba",supplier:null,sourceId:"ERP-123"}]);
 assert.deepEqual(api.queries[0].params,["ampedia"]);
 assert.deepEqual(api.queries[1].params.slice(0,2),["ampedia",[1,2]]);
 assert.ok(api.queries[1].timeout<=5000);
});
test("rechaza rangos inválidos antes de consultar PostgreSQL",async()=>{
 const api=fixture();
 const invalid=await api.call("/api/ventas/objetivos/historico",{
   cns:["123456"],pharmacyIds:[1],periods:[{id:"future",from:"2026-10-31",to:"2026-10-01"}]});
 assert.equal(invalid.status,400);
 assert.equal(api.queries.length,0);
});

test("busca por proveedor habitual en su farmacia, sin recorrer proveedores por cada artículo",async()=>{
 const api=fixture();
 const out=await api.call("/api/ventas/objetivos/buscar",
  {search:"Proveedor Ejemplo",cns:[]},[1]);
 assert.equal(out.status,200);
 assert.equal(out.response.partial,false);
 assert.equal(out.response.products[0].cn,"123456");
 assert.equal(out.response.products[0].supplier,"Proveedor Ejemplo");
 const direct=api.queries.find(q=>q.sql.includes('FROM "ampedia".articulos a JOIN farmetrica.farmacias'));
 const supplier=api.queries.find(q=>q.sql.includes("WITH allowed AS MATERIALIZED"));
 const bySupplier=api.queries.find(q=>q.sql.includes("jsonb_to_recordset"));
 assert.equal(direct.params[1][0],1);
 assert.deepEqual(supplier.params.slice(0,2),["ampedia",[1]]);
 assert.deepEqual(bySupplier.params.slice(0,2),["ampedia",[1]]);
 assert.equal(JSON.parse(bySupplier.params[2])[0].supplier_code,"PR1");
 assert.ok(bySupplier.timeout<=5000);
});
test("si la búsqueda no tiene permisos para otras farmacias nunca consulta sus artículos",async()=>{
 const api=fixture();
 await api.call("/api/ventas/objetivos/buscar",{search:"ibuprofeno",cns:[]},[1]);
 const sql=api.queries.find(q=>q.sql.includes('FROM "ampedia".articulos a JOIN farmetrica.farmacias'));
 assert.deepEqual(sql.params[1],[1]);
 assert.match(sql.sql,/f\.id=ANY\(\$2::int\[\]\)/);
});

test("al pegar un CN sin ficha ERP recupera nombre oficial si existe, sin decir no localizado",async()=>{
 const api=fixture({directRows:[],officialRows:[{cn:"194700",description:"Nombre oficial del CN"}]});
 const out=await api.call("/api/ventas/objetivos/buscar",{search:"",cns:["194700"]},[1]);
 assert.equal(out.status,200);
 assert.deepEqual(out.response.products,[{
  cn:"194700",description:"Nombre oficial del CN",supplier:null,sourceId:null
 }]);
 assert.equal(api.queries.some(q=>q.sql.includes("nomenclator_presentaciones")),true);
});
test("si el Nomenclátor tampoco conoce el CN, no inventa una descripción ni confunde el ERP",async()=>{
 const api=fixture({directRows:[],officialRows:[]});
 const out=await api.call("/api/ventas/objetivos/buscar",{search:"",cns:["168770"]},[1]);
 assert.equal(out.status,200);
 assert.deepEqual(out.response.products,[]);
});
