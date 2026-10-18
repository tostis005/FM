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
 assert.equal(result.kpis.ventas,null,"Compras no debe fingir una venta total cuando no solicita esa serie");
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

test("consultas trimestrales preagrupan ventas por artículo antes de resolver CN",async()=>{
 const {call,queries,req}=create();
 await call({query:{...req.query,modulo:"dashboard"}});
 const sales=queries.find(x=>x.sql.includes('AS "pharmacyId"')&&x.sql.includes('FROM "ampedia".ventas t'));
 assert.ok(sales,"se ejecuta la consulta de ventas por artículo");
 assert.match(sales.sql,/GROUP BY f\.id,upper\(btrim\(t\.farmacia_codigo\)\),t\.articulo_id/);
 assert.match(sales.sql,/\) t\s+JOIN farmetrica\.farmacias f/);
 assert.match(sales.sql,/LEFT JOIN LATERAL/);
 const monthly=queries.find(x=>x.sql.includes("date_trunc('month'")&&x.sql.includes('"ampedia".ventas t'));
 assert.ok(monthly);
 assert.doesNotMatch(monthly.sql,/LEFT JOIN LATERAL/,"los totales mensuales no necesitan fichas de artículos");
});
test("filtro de artículos conserva la restricción por fecha y farmacia antes de agrupar",async()=>{
 const {call,queries,req}=create();
 await call({query:{...req.query,buscar:"amoxicilina",familias:"Antibióticos"}});
 const sales=queries.find(x=>x.sql.includes('AS "pharmacyId"')&&x.sql.includes('FROM "ampedia".ventas t'));
 assert.match(sales.sql,/f\.id=ANY\(\$3::int\[\]\)/);
 assert.match(sales.sql,/t\.fecha >= \$1::date/);
 assert.match(sales.sql,/coalesce\(art\.familia,''\)=ANY\(\$5::text\[\]\)/);
});

test("los módulos ahorran consultas ajenas a sus indicadores y conservan los datos operativos",async()=>{
 const a=create();
 const provider=await a.call({query:{...a.req.query,modulo:"proveedores"}});
 assert.equal(provider.status,200);
 assert.equal(provider.result.supplierRows.length,1);
 assert.equal(provider.result.kpis.articulosComprados,1,"Proveedores debe contar compras completas sin necesitar ventas");
 assert.equal(provider.result.kpis.ventas,null);
 assert.ok(!a.queries.some(q=>q.sql.includes('FROM "ampedia".ventas t')),
   "Proveedores no debe escanear todas las ventas");
 assert.ok(!a.queries.some(q=>q.sql.includes("SELECT DISTINCT familia")),
   "Las familias se consultan sólo cuando se filtran productos");

 const b=create();
 const stock=await b.call({query:{...b.req.query,modulo:"stock"}});
 assert.equal(stock.status,200);
 assert.equal(stock.result.salesRows.length,1,"Stock necesita demanda real");
 assert.equal(stock.result.buyRows.length,1,"Stock necesita compras para coste unitario");
 assert.equal(stock.result.kpis.compras,null,"Stock no solicita el gasto mensual");
 assert.ok(!b.queries.some(q=>q.sql.includes("date_trunc('month'")&&
   q.sql.includes('"ampedia".compras')),"Stock no necesita serie mensual de compras");
 assert.ok(!b.queries.some(q=>q.sql.includes('GROUP BY f.id,t.proveedor_id')),
   "Stock no debe cargar un ranking de proveedores");
});
