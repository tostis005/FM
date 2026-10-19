import test from "node:test";
import assert from "node:assert/strict";
import {buildSalesDetailSQL,setupSalesDetail} from "./salesDetail.js";
function make(){
 const routes={},calls=[];
 const app={get(path,...handlers){routes[path]=handlers.at(-1)}};
 const pool={async query(sql,params){
  calls.push({sql,params});
  return {rows:[{pharmacyId:"5",cn:"654321",name:"Producto",family:"12",units:3,value:45,abcdClass:"A",margin:30}]};
 }};
 setupSalesDetail(app,pool,{requireTenant:()=>[]});
 const ctx={client:{slug:"ampedia",schema:"ampedia"},role:"administrador",
  modules:{ventas:true},allowedPharmacyIds:[1,5],
  pharmacies:[{id:"1",sourceCode:"ABA"},{id:"5",sourceCode:"POL",databaseCode:"VAL"}]};
 async function request(query={}){
  const req={context:ctx,query:{desde:"2025-11-01",hasta:"2026-10-18",farmacias:"5",...query}};
  const res={status(code){res.code=code;return res},json(data){res.data=data;return res}};
  let err;
  await routes["/api/analytics/ventas/detalle"](req,res,e=>{err=e});
  if(err)throw err;
  return {status:res.code||200,data:res.data};
 }
 return {request,calls};
}
test("detalle pagina en PostgreSQL y solo cruza compras para referencias de la página",async()=>{
 const {request,calls}=make();const {data,status}=await request();
 assert.equal(status,200);
 assert.equal(data.products.length,1);
 assert.equal(data.products[0].abcdClass,"A");
 assert.equal(data.products[0].margin,30);
 assert.equal(data.products[0].id,"5|654321");
 assert.equal(calls.length,1);
 assert.deepEqual(calls[0].params,["2025-11-01","2026-10-18",["VAL"],["5"],"",[],401,0]);
 assert.match(calls[0].sql,/page AS MATERIALIZED/);
 assert.match(calls[0].sql,/FROM page p LEFT JOIN costs/);
 assert.doesNotMatch(calls[0].sql,/date_trunc\('month'|GROUPING SETS|jsonb_agg/);
});
test("familias, paginación y farmacias no autorizadas",async()=>{
 const {request,calls}=make();
 await request({pagina:"2",familias:"12",buscar:"654321"});
 assert.deepEqual(calls[0].params.slice(4),["654321",["12"],401,400]);
 assert.equal((await request({farmacias:"9"})).status,403);
 assert.equal((await request({farmacias:"1,5",familias:"12"})).status,400);
 assert.equal((await request({pagina:"0"})).status,400);
 assert.equal((await request({desde:"1899-01-01"})).status,400);
 assert.throws(()=>buildSalesDetailSQL("ampedia;DROP"));
});

test("ordena todo el universo ANTES de paginar y conserva ese orden en la salida",async()=>{
 const {request,calls}=make();
 const r=await request({orden:"units",direccion:"asc",pagina:"2"});
 assert.equal(r.status,200);
 const sql=calls[0].sql;
 assert.match(sql,/FROM visible\s+ORDER BY "__order" ASC NULLS LAST/);
 assert.match(sql,/units AS "__order"/);
 assert.match(sql,/ORDER BY p\."__order" ASC NULLS LAST/);
 assert.match(sql,/LIMIT \$7::int OFFSET \$8::int/);
 assert.ok(sql.indexOf('ORDER BY "__order"')<sql.indexOf("LIMIT $7"));
 assert.equal((await request({orden:"no_permitido"})).status,400);
 assert.equal((await request({direccion:"no_permitida"})).status,400);
});
test("margen, PUC y coste exigen ordenar los costes ponderados de TODO el conjunto",()=>{
 for(const key of ["purchaseCost","unitMargin","margin","marginPct","costSource"]){
  const sql=buildSalesDetailSQL("ampedia",key,"desc");
  assert.match(sql,/global_costs AS/);
  assert.match(sql,/with_cost_sort AS/);
  assert.match(sql,/FROM with_cost_sort\s+ORDER BY "__order" DESC NULLS LAST/);
  assert.ok(sql.indexOf("global_costs AS")<sql.indexOf("LIMIT $7"));
 }
 const defaultSql=buildSalesDetailSQL("ampedia");
 assert.doesNotMatch(defaultSql,/global_costs AS/,"El ranking normal no cruza compras de todo el universo");
});

test("detalle de ventas soporta catálogo y compras antiguas y fuente ausente",()=>{
 const legacy=buildSalesDetailSQL("farmacia_legado","margin","desc",
  {articles:"legacy",purchases:"legacy"});
 assert.match(legacy,/FROM "farmacia_legado"\.productos p/);
 assert.match(legacy,/b\.farmacia_id::text=c\."pharmacyId"/);
 assert.match(legacy,/b\.producto_id=c\.articulo_id/);
 assert.match(legacy,/b\.puc>0/);
 assert.doesNotMatch(legacy,/FROM "farmacia_legado"\.articulos/);
 const stockOnly=buildSalesDetailSQL("farmacia_legado","margin","asc",
  {articles:"none",purchases:"none"});
 assert.match(stockOnly,/NULL::float8 AS cost/);
 assert.doesNotMatch(stockOnly,/JOIN "farmacia_legado"\.compras/);
 assert.doesNotMatch(stockOnly,/FROM "farmacia_legado"\.articulos/);
 assert.throws(()=>buildSalesDetailSQL("farmacia_legado","margin","desc",
  {articles:"otro",purchases:"legacy"}));
});

test("detalle acepta cualquier período del selector, incluidas fechas personalizadas y mes en curso",async()=>{
 const {request,calls}=make();
 for(const [from,to] of [["2026-10-01","2026-10-18"],["2026-10-18","2026-10-18"],
   ["2026-09-12","2026-10-04"],["2024-11-01","2026-10-18"],["1900-01-01","2026-10-18"]]){
  const {status,data}=await request({desde:from,hasta:to});
  assert.equal(status,200);
  assert.equal(data.from,from);
  assert.equal(data.to,to);
  const args=calls.at(-1).params;
  assert.deepEqual(args.slice(0,2),[from,to],"SQL debe usar el filtro de cabecera y no 12 meses");
 }
});
