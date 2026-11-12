import test from "node:test";
import assert from "node:assert/strict";
import {buildSalesActivitySQL,summarizeSalesActivityRows,setupSalesActivity} from "./salesActivity.js";

const pharmacies=[
 {id:"1",name:"Abadía",databaseCode:"ABA"},
 {id:"5",name:"Valdemarías",sourceCode:"POL",databaseCode:"VAL"}
];
const sample=[
 {kind:"farmacia",code:"ABA",sales:90,units:15,productUnits:14,tickets:3,lines:5},
 {kind:"farmacia",code:"VAL",sales:110,units:20,productUnits:18,tickets:2,lines:6},
 {kind:"horario",weekday:1,hour:9,sales:80,lines:4},
 {kind:"horario",weekday:1,hour:10,sales:120,lines:7},
 {kind:"vendedor",code:"ABA",sellerId:"12",sales:90,units:15},
 {kind:"vendedor",code:"VAL",sellerId:"12",sales:110,units:20}
];
test("una agregación directa obtiene horarios y vendedores sin GROUP BY de tickets",()=>{
 const sql=buildSalesActivitySQL("ampedia");
 assert.match(sql,/GROUP BY GROUPING SETS \(\(v\.farmacia_codigo,v\.vendedor_id\),/);
 assert.match(sql,/extract\(isodow FROM v\.fecha\)/);
 assert.match(sql,/extract\(hour FROM v\.fecha\)/);
 assert.match(sql,/v\.farmacia_codigo=ANY\(\$3::text\[\]\)/);
 assert.match(sql,/v\.fecha >= \$1::date/);
 assert.doesNotMatch(sql,/documents AS MATERIALIZED|count\(DISTINCT|GROUP BY 1,2,3/);
 assert.throws(()=>buildSalesActivitySQL('bad";DROP TABLE t;--'));
});
test("mapa y vendedores se agrupan sin mezclar códigos de farmacias",()=>{
 const named=[
  {pharmacyId:"1",sellerId:"12",sellerName:"Ana",sales:90,units:15},
  {pharmacyId:"5",sellerId:"12",sellerName:"Luisa",sales:110,units:20}
 ];
 const result=summarizeSalesActivityRows(sample,pharmacies,[1,5],named);
 assert.equal(result.tickets.kpis.tickets,5);
 assert.equal(result.tickets.kpis.ticketMedio,40);
 assert.equal(result.tickets.kpis.unidadesPorTicket,32/5);
 assert.deepEqual(result.tickets.pharmacies.map(p=>p.id),["5","1"]);
 assert.equal(result.horarios.total,200);
 assert.deepEqual(result.horarios.cells.map(c=>c.sales),[80,120]);
 assert.deepEqual(result.vendedores.sellers.map(s=>s.name),[
  "Luisa · Valdemarías","Ana · Abadía"
 ]);
 assert.equal(result.vendedores.total,200);
});
test("endpoint de actividad no ejecuta tres consultas de ventas ni permite otra farmacia",async()=>{
 const handlers=new Map(),queries=[];
 const app={get(path,...chain){handlers.set(path,chain.at(-1))}};
 const pool={async query(q){
  queries.push(q);
  if(q?.text?.includes("GROUPING SETS"))return {rows:sample};
  return {rows:[]}; // catálogo de vendedores opcional
 }};
 setupSalesActivity(app,pool,{requireTenant:()=>[]});
 const ctx={role:"gestor",modules:{ventas:true},client:{slug:"ampedia",schema:"ampedia"},
  allowedPharmacyIds:[1,5],pharmacies};
 const call=async(query,context=ctx)=>{
  const req={context,query};
  const res={code:200,status(n){this.code=n;return this},json(v){this.data=v;return this}};
  let error;await handlers.get("/api/analytics/ventas/actividad")(req,res,e=>{error=e});
  if(error)throw error;return res;
 };
 const args={desde:"2026-11-01",hasta:"2026-11-12",farmacias:"1,5"};
 const ok=await call(args);
 assert.equal(ok.code,200);
 assert.equal(ok.data.tickets.kpis.tickets,5);
 assert.equal(ok.data.horarios.cells.length,2);
 assert.equal(ok.data.vendedores.sellers.length,2);
 assert.equal(queries.filter(q=>q?.text?.includes("GROUPING SETS")).length,1);
 assert.deepEqual(queries[0].values,["2026-11-01","2026-11-12",["ABA","VAL"]]);
 assert.equal((await call({...args,farmacias:"99"})).code,403);
 assert.equal((await call({...args,hasta:"2026-01-01"})).code,400);
 assert.equal((await call(args,{...ctx,modules:{ventas:false,dashboard:false}})).code,403);
 assert.equal(queries.filter(q=>q?.text?.includes("GROUPING SETS")).length,1);
});
