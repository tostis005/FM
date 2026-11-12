import test from "node:test";
import assert from "node:assert/strict";
import {buildSalesFamilyRankingSQL,mergeSalesFamilyRows,buildSalesTicketsSQL,
 buildSalesTicketCountsSQL,summarizeSalesTicketCounts,summarizeSalesTickets,
 buildSalesTicketHeatmapSQL,summarizeSalesTicketHeatmap,setupSalesOverview} from "./salesOverview.js";
test("agrupa nombres equivalentes, respeta segmentos y conserva la facturación",()=>{
 const result=mergeSalesFamilyRows([
  {familyId:"1",name:"Dermocosmetica",segment:"PARAFARMACIA",sales:100,units:8,lines:4},
  {familyId:"2",name:"Dermocosmética",segment:"MEDICACION",sales:40,units:2,lines:2},
  {familyId:"3",name:"Farmacia",segment:"PARAFARMACIA",sales:70,units:5,lines:3},
  {familyId:null,sales:10,units:0,lines:1}
 ]);
 assert.equal(result.families.length,3);
 assert.equal(result.families[0].name,"Dermocosmética");
 assert.equal(result.families[0].sales,140);
 assert.deepEqual(result.families[0].segments,["PARAFARMACIA","MEDICACION"]);
 assert.equal(result.families.at(-1).name,"Sin clasificar");
 assert.equal(result.totalSales,220);
 assert.equal(result.coveragePct,90);
});
test("la familia se deriva de una relación ERP única, filtrada por tenant",()=>{
 const sql=buildSalesFamilyRankingSQL("ampedia");
 assert.match(sql,/WITH mapped AS MATERIALIZED/);
 assert.match(sql,/GROUP BY link\.familia_id/);
 assert.doesNotMatch(sql,/GROUP BY 1,2/);
 assert.match(sql,/link\.cliente_slug=\$4/);
 assert.match(sql,/link\.articulo_origen_id=v\.articulo_id/);
 assert.match(sql,/g\.activo/);
 assert.match(sql,/v\.farmacia_codigo=ANY\(\$3::text\[\]\)/);
 assert.throws(()=>buildSalesFamilyRankingSQL('bad";drop table z;--'));
});
test("el ticket medio se calcula por documento, no por línea o media de farmacias",()=>{
 const sql=buildSalesTicketsSQL("ampedia");
 assert.match(sql,/v\.sistema_origen,v\.documento_id/);
 assert.match(sql,/GROUP BY 1,2,3/);
 assert.match(sql,/count\(\*\)::bigint AS tickets/);
 const data=summarizeSalesTickets([
  {code:"ABA",tickets:2,sales:50,units:4},{code:"EUR",tickets:8,sales:350,units:20}
 ],[{id:"1",name:"Abadía",sourceCode:"ABA"},
  {id:"2",name:"Europa",sourceCode:"EUR"}],[1,2]);
 assert.equal(data.kpis.tickets,10);
 assert.equal(data.kpis.ticketMedio,40);
 assert.equal(data.kpis.unidadesPorTicket,2.4);
 assert.equal(data.pharmacies[0].name,"Europa");
});
test("endpoints no permiten consultar farmacias ajenas o módulos deshabilitados",async()=>{
 const routes=new Map(),queries=[];
 const app={get(path,...stack){routes.set(path,stack.at(-1))}};
 const pool={async query(q){
  queries.push(q);
  return {rows:q.text.includes("familias_globales_articulos")?
   [{familyId:"7",name:"Higiene",segment:"PARAFARMACIA",sales:45,units:3,lines:2}]:
   [{code:"ABA",tickets:2,sales:45,units:3}]};
 }};
 setupSalesOverview(app,pool,{requireTenant:()=>[]});
 const ctx={role:"gestor",client:{slug:"ampedia",schema:"ampedia"},
  modules:{ventas:true,dashboard:false},allowedPharmacyIds:[1],
  pharmacies:[{id:"1",name:"Abadía",sourceCode:"ABA"}]};
 const invoke=async(endpoint,query={},context=ctx)=>{
  const req={context,query},res={code:200,status(n){this.code=n;return this},json(d){this.data=d;return this}};
  let error;await routes.get("/api/analytics/ventas/"+endpoint)(req,res,e=>{error=e});
  if(error)throw error;return res;
 };
 const args={desde:"2026-11-01",hasta:"2026-11-12",farmacias:"1"};
 const f=await invoke("familias-ranking",args);
 assert.equal(f.data.totalSales,45);
 const t=await invoke("ticket-medio",args);
 assert.equal(t.data.kpis.ticketMedio,22.5);
 assert.deepEqual(queries[0].values,["2026-11-01","2026-11-12",["ABA"],"ampedia"]);
 assert.deepEqual(queries[1].values,["2026-11-01","2026-11-12",["ABA"]]);
 assert.equal((await invoke("familias-ranking",{...args,farmacias:"2"})).code,403);
 assert.equal((await invoke("ticket-medio",{...args,desde:"2026-12-01"})).code,400);
 assert.equal((await invoke("ticket-medio",args,{...ctx,modules:{ventas:false,dashboard:false}})).code,403);
 assert.equal(queries.length,2);
});

test("ticket medio rápido cuenta cabeceras documentales válidas sin agrupar líneas",()=>{
 const sql=buildSalesTicketCountsSQL("ampedia");
 assert.match(sql,/fm_ventas_cabeceras h/);
 assert.match(sql,/EXISTS\(SELECT 1 FROM "ampedia"\.fm_ventas_lineas/);
 assert.match(sql,/h\.farmacia_codigo=ANY\(\$3::text\[\]\)/);
 assert.match(sql,/h\.lineas_completas/);
 assert.doesNotMatch(sql,/GROUP BY.*documento_id|fm_ventas_analitica/);
 const result=summarizeSalesTicketCounts([{code:"ABA",tickets:5},{code:"EUR",tickets:12}],
  [{id:1,name:"Abadía",databaseCode:"ABA"},
   {id:2,name:"Europa",databaseCode:"EUR"}],[1,2]);
 assert.equal(result.tickets,17);
 assert.deepEqual(result.pharmacies.map(p=>p.id),["1","2"]);
});

test("el mapa cuenta cabeceras válidas una vez por ticket, no artículos",()=>{
 const sql=buildSalesTicketHeatmapSQL("ampedia");
 assert.match(sql,/FROM "ampedia"\.fm_ventas_cabeceras h/);
 assert.match(sql,/count\(\*\)::bigint AS tickets/);
 assert.match(sql,/extract\(isodow FROM h\.fecha\)/);
 assert.match(sql,/extract\(hour FROM h\.fecha\)/);
 assert.match(sql,/h\.lineas_completas AND NOT h\.eliminado_logicamente/);
 assert.match(sql,/AND EXISTS\(SELECT 1 FROM "ampedia"\.fm_ventas_lineas l/);
 assert.match(sql,/l\.documento_id=h\.documento_id/);
 assert.doesNotMatch(sql,/fm_ventas_analitica|count\(DISTINCT/);
 assert.throws(()=>buildSalesTicketHeatmapSQL('bad";drop table x;--'));
 const result=summarizeSalesTicketHeatmap([
  {weekday:1,hour:9,tickets:"3"},{weekday:2,hour:11,tickets:"4"}
 ]);
 assert.deepEqual(result,{cells:[{weekday:1,hour:9,tickets:3},
  {weekday:2,hour:11,tickets:4}],total:7});
});
test("endpoint horario aplica permisos y devuelve operaciones por franja",async()=>{
 const routes=new Map(),calls=[];
 const app={get(path,...args){routes.set(path,args.at(-1))}};
 const conn={async query(arg){
  calls.push(arg);
  if(typeof arg==="object")return {rows:[{weekday:1,hour:9,tickets:"2"},
   {weekday:7,hour:21,tickets:"5"}]};
  return {rows:[]};
 },release(){}};
 setupSalesOverview(app,{connect:async()=>conn},{requireTenant:()=>[]});
 const context={role:"gestor",client:{slug:"ampedia",schema:"ampedia"},
  modules:{ventas:true},allowedPharmacyIds:[1],
  pharmacies:[{id:"1",name:"Abadía",sourceCode:"ABA"}]};
 const run=async(query,ctx=context)=>{
  const res={code:200,status(n){this.code=n;return this},
   json(v){this.data=v;return this},setHeader(){}};
  let error;await routes.get("/api/analytics/ventas/horarios-tickets")(
   {context:ctx,query},res,e=>{error=e});
  if(error)throw error;return res;
 };
 const q={desde:"2026-11-01",hasta:"2026-11-12",farmacias:"1"};
 const ok=await run(q);
 assert.equal(ok.code,200);
 assert.equal(ok.data.total,7);
 assert.deepEqual(ok.data.cells.map(c=>c.tickets),[2,5]);
 assert.deepEqual(calls.find(x=>typeof x==="object").values,
  ["2026-11-01","2026-11-12",["ABA"]]);
 assert.equal((await run({...q,farmacias:"2"})).code,403);
 assert.equal((await run(q,{...context,modules:{ventas:false}})).code,403);
 assert.equal(calls.filter(x=>typeof x==="object").length,1);
});
