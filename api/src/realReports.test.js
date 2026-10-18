import test from "node:test";
import assert from "node:assert/strict";
import {setupRealReports} from "./realReports.js";

function create(){
 const routes={};const app={get(path,...handlers){routes[path]=handlers.at(-1)}};
 const tableFields={
  articulos:["farmacia_codigo","origen_id","nombre","codigo_nacional","familia","pvp","pmc"],
  ventas:["farmacia_codigo","articulo_id","fecha","unidades","importe"],
  compras:["farmacia_codigo","articulo_id","proveedor_id","proveedor_nombre","unidades","coste_unitario","importe","fecha"],
  proveedores:["farmacia_codigo","origen_id","nombre"]
 };
 const queries=[];
 const pool={async query(sql,params=[]){
  queries.push({sql,params});
  const max=Math.max(0,...[...sql.matchAll(/\$(\d+)/g)].map(m=>Number(m[1])));
  assert.equal(params.length,max,"Fallan parámetros SQL: "+sql.slice(0,120));
  if(sql.includes("information_schema.columns"))
   return {rows:(tableFields[params[1]]||[]).map(column_name=>({column_name}))};
  if(sql.includes("to_regclass"))return {rows:[{tbl:null}]};
  if(sql.includes("SELECT DISTINCT familia"))return {rows:[{familia:"Antibióticos"}]};
  if(sql.includes("AS \"pharmacyId\"")&&sql.includes(".ventas"))
   return {rows:[{pharmacyId:"1",cn:"654321",name:"Amoxicilina",family:"Antibióticos",
    pvp:6,pmc:1,laboratory:"Lab A",units:20,value:120}]};
  if(sql.includes('SELECT f.id::text AS "pharmacyId",t.proveedor_id AS "providerId"'))
   return {rows:[{pharmacyId:"1",providerId:"2",name:"Distribuidora",value:60,units:30,products:1}]};
  if(sql.includes("AS \"pharmacyId\"")&&sql.includes(".compras"))
   return {rows:[{pharmacyId:"1",cn:"654321",name:"Amoxicilina",family:"Antibióticos",
    pvp:6,pmc:1,laboratory:"Lab A",providerId:"2",supplier:"Distribuidora",
    units:30,value:60,cost:45,pricedUnits:30,lines:4}]};
  if(sql.includes("date_trunc('month'")&&sql.includes(".ventas"))
   return {rows:[{month:"2026-10",units:20,amount:120}]};
  if(sql.includes("date_trunc('month'")&&sql.includes(".compras"))
   return {rows:[{month:"2026-10",units:30,amount:60}]};

  throw Error("SQL inesperado: "+sql.slice(0,180));
 }};
 setupRealReports(app,pool,{requireTenant:()=>[]});
 const req={query:{desde:"2026-10-01",hasta:"2026-10-18",modulo:"compras",farmacias:"1"},
  context:{client:{slug:"ampedia",schema:"ampedia"},role:"superadministrador",
  modules:{},allowedPharmacyIds:[1],pharmacies:[{id:"1",sourceCode:"ABA"}]}};
 async function call(changes={}){
  let status=200,result;const res={status(n){status=n;return this},json(v){result=v;return this}};
  let error;await routes["/api/analytics/reportes"]({...req,...changes},res,e=>{error=e});
  if(error)throw error;
  return {status,result};
 }
 return {call,queries,req};
}

test("reportes calculan PUC y margen bruto estimado ponderando unidades",async()=>{
 const {call,queries}=create();
 const {status,result}=await call();
 assert.equal(status,200);
 assert.equal(result.kpis.ventas,120);
 assert.equal(result.kpis.compras,60);
 assert.equal(result.kpis.margen,90);
 assert.equal(result.salesRows[0].purchaseCost,1.5);
 assert.equal(result.salesRows[0].pvpMarginPct,75);
 assert.equal(result.buyRows[0].puc,1.5);
 assert.equal(result.salesRows[0].abcdClass,"A");
 assert.equal(result.buyRows[0].abcdClass,"A");
 assert.equal(result.supplierRows[0].name,"Distribuidora");
 assert.equal(result.supplierRows[0].id,"1|2");
 assert.ok(queries.some(x=>x.sql.includes("GROUP BY f.id,t.proveedor_id")));
 assert.equal(result.availability.stock,false);
 assert.equal(result.kpis.stock,null);
 assert.ok(queries.some(x=>x.sql.includes(".articulos")));
 assert.ok(queries.some(x=>x.sql.includes(".proveedores")));
});
test("no accede a otra farmacia",async()=>{
 const {call,req}=create();
 const {status,result}=await call({query:{...req.query,farmacias:"2"}});
 assert.equal(status,403);assert.match(result.error,/no autorizada/i);
});
test("no accede a módulo no autorizado",async()=>{
 const {call,req}=create();
 const {status,result}=await call({context:{...req.context,role:"farmacia",
  modules:{ventas:true}},query:{...req.query,modulo:"compras"}});
 assert.equal(status,403);assert.match(result.error,/no habilitado/i);
});

test("ABCD usa ventas completas por farmacia aunque haya filtro de búsqueda/familia",async()=>{
 const {call,queries,req}=create();
 const {status,result}=await call({query:{...req.query,buscar:"amoxicilina",familias:"Antibióticos"}});
 assert.equal(status,200);
 assert.equal(result.salesRows[0].abcdClass,"A");
 assert.ok(queries.some(({sql})=>sql.includes('GROUP BY f.id,')&&
  sql.includes('AS "pharmacyId"')&&sql.includes(".ventas")&&!sql.includes("ILIKE")),
  "el ranking no debe recortarse a los artículos visibles");
});
