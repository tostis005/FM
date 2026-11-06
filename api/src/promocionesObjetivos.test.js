import test from "node:test";
import assert from "node:assert/strict";
import {setupPromotionObjectives} from "./promocionesObjetivos.js";

function fixture({directRows,stockRows,matchedSupplierRows}={}){
 const routes=new Map(),queries=[];
 const pool={async query(input,values=[]){
  const sql=typeof input==="string"?input:input.text;
  const params=typeof input==="string"?values:input.values||[];
  queries.push({sql,params,timeout:input?.query_timeout});
  if(sql.includes("WITH latest AS"))return {rows:stockRows??[{pharmacy_id:"1",units:12,updated_at:"2026-11-06T00:00:00Z"}]};
  if(sql.includes("SELECT DISTINCT f.id::text AS pharmacy_id"))
   return {rows:[{pharmacy_id:"1",source_id:"ERP-123"}]};
  if(sql.includes("sum(v.unidades) FILTER (WHERE"))
   return {rows:[{pharmacy_id:"1",units_0:7,amount_0:53.8,
    units_1:4,amount_1:20}]};
  if(sql.includes("SELECT table_name,column_name FROM information_schema.columns"))
   return {rows:[
    ...["farmacia_codigo","origen_id","nombre","codigo_nacional","cn_normalizado",
      "laboratorio","proveedor_habitual_id","stock_actual","sincronizado_en"].map(column_name=>({table_name:"articulos",column_name})),
    ...["farmacia_codigo","origen_id","nombre"]
      .map(column_name=>({table_name:"proveedores",column_name}))
   ]};
  if(sql.includes("WITH allowed AS MATERIALIZED"))
   return {rows:[{pharmacy_code:"ABA",supplier_code:"PR1",supplier_name:"Proveedor Ejemplo"}]};
  if(sql.includes("jsonb_to_recordset"))
   return {rows:matchedSupplierRows??[{pharmacy_id:"1",source_id:"ERP-123",description:"Artículo de prueba",
    national_code:"123456",normalized_code:null,laboratory:null,supplier_ref:"PR1",
    supplier_name:"Proveedor Ejemplo"}]};
  if(sql.includes("FROM \"ampedia\".articulos a JOIN farmetrica.farmacias"))
   return {rows:directRows??[{pharmacy_id:"1",source_id:"ERP-123",description:"Artículo de prueba",
    national_code:"123456",normalized_code:null,laboratory:null,supplier_ref:"PR1",
    supplier_name:null}]};
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
 assert.deepEqual(api.queries[1].params,["ampedia",[1],["123456"]]);
 assert.deepEqual(api.queries[2].params,
   ["ampedia",[1],["123456"],["123456","ERP-123"],["1|ERP-123"],
    "2026-10-01","2026-10-31"]);
 assert.match(api.queries[2].sql,/sum\(v.importe\) FILTER \(WHERE/);
 assert.match(api.queries[2].sql,/btrim\(v.articulo_id::text\)=ANY\(\$4::text\[\]\)/);
 assert.ok(api.queries[2].timeout<=30000);
 assert.deepEqual(response.stock,{"1":12});
 assert.equal(response.stockUnavailable,false);
 assert.match(api.queries[3].sql,/DISTINCT ON \(f.id,a.origen_id\)/);
 assert.match(api.queries[3].sql,/stock_actual/);
 assert.deepEqual(api.queries[3].params,["ampedia",[1],["123456"]]);
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
 assert.ok(api.queries[1].timeout<=8000);
});
test("rechaza rangos inválidos antes de consultar PostgreSQL",async()=>{
 const api=fixture();
 const invalid=await api.call("/api/ventas/objetivos/historico",{
   cns:["123456"],pharmacyIds:[1],periods:[{id:"future",from:"2026-10-31",to:"2026-10-01"}]});
 assert.equal(invalid.status,400);
 assert.equal(api.queries.length,0);
});

test("busca por proveedor habitual en su farmacia, sin recorrer proveedores por cada artículo",async()=>{
 const api=fixture({directRows:[]});
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
 assert.deepEqual(direct.params[2],["%Proveedor%","%Ejemplo%"]);
 assert.equal(direct.params[5],"%proveedor%");
 assert.match(direct.sql,/LIKE \$6::text/);
 assert.deepEqual(supplier.params[2],["%Proveedor%","%Ejemplo%"]);
 assert.deepEqual(bySupplier.params[5],["%Proveedor%","%Ejemplo%"]);
 assert.ok(bySupplier.timeout<=8000);
});
test("si la búsqueda no tiene permisos para otras farmacias nunca consulta sus artículos",async()=>{
 const api=fixture();
 await api.call("/api/ventas/objetivos/buscar",{search:"ibuprofeno",cns:[]},[1]);
 const sql=api.queries.find(q=>q.sql.includes('FROM "ampedia".articulos a JOIN farmetrica.farmacias'));
 assert.deepEqual(sql.params[1],[1]);
 assert.match(sql.sql,/f\.id=ANY\(\$2::int\[\]\)/);
});

test("un CN sin ficha Farmatic no usa el Nomenclátor ni inventa un nombre",async()=>{
 const api=fixture({directRows:[]});
 const out=await api.call("/api/ventas/objetivos/buscar",{search:"",cns:["194700"]},[1]);
 assert.equal(out.status,200);
 assert.deepEqual(out.response.products,[]);
 assert.equal(api.queries.some(q=>/nomenclator|aemps|official/i.test(q.sql)),false);
});

test("paginación por CN: las filas de ERP no consumen cupo antes de DISTINCT",async()=>{
 const api=fixture();
 const out=await api.call("/api/ventas/objetivos/buscar",
  {search:"Crema",cns:[],page:2},[1]);
 assert.equal(out.status,200);
 const direct=api.queries.find(q=>q.sql.includes("SELECT DISTINCT ON (resolved_cn)"));
 assert.ok(direct);
 assert.equal(direct.params[3],181);
 assert.equal(direct.params[4],360);
 assert.equal(out.response.hasMore,false);
 assert.ok(direct.sql.includes("ORDER BY resolved_cn"));
});
test("rechaza paginaciones fuera de rango sin acceder al catálogo",async()=>{
 const api=fixture();
 const out=await api.call("/api/ventas/objetivos/buscar",
  {search:"Crema",cns:[],page:-1});
 assert.equal(out.status,400);
 assert.equal(api.queries.length,0);
});

test("el buscador sólo devuelve artículos existentes en Farmatic",async()=>{
 const api=fixture({directRows:[],matchedSupplierRows:[]});
 const out=await api.call("/api/ventas/objetivos/buscar",
  {search:"Cosmo Solar",cns:[]},[1]);
 assert.equal(out.status,200);
 assert.deepEqual(out.response.products,[]);
 assert.ok(!api.queries.some(q=>/nomenclator_presentaciones/.test(q.sql)));
});

test("no se permiten búsquedas artificialmente largas",async()=>{
 const api=fixture();
 const search=Array.from({length:13},(_,i)=>"a"+i).join(" ");
 const out=await api.call("/api/ventas/objetivos/buscar",{search,cns:[]},[1]);
 assert.equal(out.status,400);
 assert.equal(api.queries.length,0);
});

test("el CN 168766 pegado recupera el nombre desde Farmatic aunque falte en el Nomenclátor",async()=>{
 const api=fixture({directRows:[{
  pharmacy_id:"1",source_id:"168766",resolved_cn:"168766",
  reference_type:"farmatic",national_code:null,normalized_code:null,
  description:"Eucerin Atopi Control 250 ml",supplier_name:null,laboratory:null
 }]});
 const out=await api.call("/api/ventas/objetivos/buscar",
  {search:"",cns:["168766"]},[1]);
 assert.equal(out.status,200);
 assert.deepEqual(out.response.products,[{
  cn:"168766",description:"Eucerin Atopi Control 250 ml",supplier:null,
  sourceId:"168766",referenceType:"farmatic"
 }]);
 const byCode=api.queries.find(q=>q.sql.includes("SELECT DISTINCT ON (resolved_cn)"));
 assert.deepEqual(byCode.params[2],["168766"]);
 assert.match(byCode.sql,/a\."nombre"::text AS description/);
});

test("stock suma artículos seleccionados por farmacia, con cero real y sin mezclar ámbitos",async()=>{
 const api=fixture({stockRows:[
  {pharmacy_id:"1",units:9,updated_at:"2026-11-06T00:00:00Z"},
  {pharmacy_id:"2",units:0,updated_at:"2026-11-06T01:00:00Z"}
 ]});
 const {status,response}=await api.call("/api/ventas/objetivos/historico",{
  cns:["123456","168766"],pharmacyIds:[1,2],periods});
 assert.equal(status,200);
 assert.deepEqual(response.stock,{"1":9,"2":0});
 assert.equal(response.stockUnavailable,false);
 const q=api.queries.find(q=>q.sql.includes("WITH latest AS"));
 assert.ok(q);
 assert.match(q.sql,/DISTINCT ON \(f.id,a.origen_id\)/);
 assert.match(q.sql,/a.stock_actual::float8/);
 assert.match(q.sql,/f.id=ANY\(\$2::int\[\]\)/);
 assert.match(q.sql,/a.origen_id::text/);
 assert.deepEqual(q.params,["ampedia",[1,2],["123456","168766"]]);
});

test("cuatro períodos de 500 CN ejecutan una sola agregación de ventas",async()=>{
 const api=fixture();
 const cns=Array.from({length:500},(_,i)=>String(i).padStart(6,"0"));
 const four=[
  {id:"previous",from:"2026-10-01",to:"2026-10-31"},
  {id:"year",from:"2025-10-01",to:"2025-10-31"},
  {id:"twoYears",from:"2024-10-01",to:"2024-10-31"},
  {id:"custom",from:"2026-11-01",to:"2026-11-06"}
 ];
 const {status,response}=await api.call("/api/ventas/objetivos/historico",
  {cns,pharmacyIds:[1],periods:four});
 assert.equal(status,200);
 assert.equal(response.periods.previous["1"],7);
 assert.equal(response.periods.year["1"],4);
 const sales=api.queries.filter(q=>q.sql.includes("sum(v.unidades) FILTER (WHERE"));
 assert.equal(sales.length,1,"no consultar la tabla de ventas cuatro veces");
 assert.equal(sales[0].params.length,5+four.length*2);
 assert.ok(sales[0].params[3].includes("ERP-123"));
 assert.match(sales[0].sql,/OR \(v.fecha >= \$12::date/);
 const links=api.queries.find(q=>q.sql.includes("SELECT DISTINCT f.id::text AS pharmacy_id"));
 assert.match(links.sql,/left\(btrim\(a.codigo_nacional::text\),6\)=ANY/);
});

test("800 CN válidos no son rechazados por la API de catálogo y de histórico",async()=>{
 const api=fixture();
 const cns=Array.from({length:800},(_,i)=>String(i).padStart(6,"0"));
 const found=await api.call("/api/ventas/objetivos/buscar",{search:"",cns},[1]);
 assert.equal(found.status,200);
 const result=await api.call("/api/ventas/objetivos/historico",{
  cns,pharmacyIds:[1],periods});
 assert.equal(result.status,200);
 assert.equal(result.response.periods.october["1"],7);
 const sales=api.queries.filter(q=>q.sql.includes("sum(v.unidades) FILTER (WHERE"));
 assert.equal(sales.length,1);
});

test("stock parcial por un producto sin sincronizar conserva otras unidades de esa farmacia",async()=>{
 const api=fixture({stockRows:[
  {pharmacy_id:"1",units:18,complete:false,updated_at:"2026-11-06T08:00:00Z"},
  {pharmacy_id:"2",units:5,complete:true,updated_at:"2026-11-06T08:00:00Z"},
  {pharmacy_id:"3",units:null,complete:false,updated_at:"2026-11-06T08:00:00Z"}
 ]});
 const {response}=await api.call("/api/ventas/objetivos/historico",{
  cns:["123456","654321"],pharmacyIds:[1,2,3],periods},[1,2,3]);
 assert.deepEqual(response.stock,{"1":18,"2":5});
 assert.deepEqual(response.stockMissingPharmacyIds,["1","3"]);
 assert.equal(response.stockUnavailable,false);
 const sql=api.queries.find(q=>q.sql.includes("WITH latest AS")).sql;
 assert.match(sql,/sum\(stock\)::float8 AS units/);
 assert.doesNotMatch(sql,/coalesce\(sum\(stock\),0\)/);
});
