import test from "node:test";
import assert from "node:assert/strict";
import {setupGenericAnalytics} from "./genericos.js";

function fixture({withSearch=false}={}){
 const routes={};
 const app={get(path,...handlers){routes[path]=handlers.at(-1)}};
 const calls=[];
 const columns={
  fm_ventas_analitica:["farmacia_codigo","articulo_id","fecha","unidades","importe"],
  fm_recepciones_analitica:["farmacia_codigo","articulo_id","fecha","unidades","coste_unitario"],
  productos:["id","cn"],
  proveedores:["id","nombre"]
 };
 const pool={async query(sql,params=[]){
  calls.push({sql,params});
  const highest=Math.max(0,...[...sql.matchAll(/\$(\d+)/g)].map(m=>Number(m[1])));
  assert.equal(params.length,highest,
   "SQL prepared parameter mismatch: required $"+highest+" got "+params.length+" in "+sql.slice(0,100));
  if(sql.includes("information_schema.columns"))
   return {rows:(columns[params[1]]||[]).map(column_name=>({column_name}))};
  if(sql.includes("SELECT sha256,fecha_fuente"))return {rows:[{
   sha256:"a".repeat(64),total_presentaciones:30861,total_genericos:15987}]};
  if(sql.includes("SELECT dcpf,min(coalesce"))return {rows:[{
   dcpf:"10531000140107",principle:"Amoxicilina",name:"Amoxicilina 500 mg 20 cápsulas",
   skuCount:3,labCount:3,genericCount:2}]};
  if(sql.includes("SELECT DISTINCT dcpf"))return {rows:[{dcpf:"10531000140107"}]};
  if(sql.includes("SELECT n.dcpf")&&sql.includes(".fm_ventas_analitica"))return {rows:[{
   dcpf:"10531000140107",units:25,revenue:125}]};
  if(sql.includes("SELECT n.dcpf")&&sql.includes(".fm_recepciones_analitica"))return {rows:[{
   dcpf:"10531000140107",units:20,spend:30,avg_puc:1.5,best_puc:1.3}]};
  if(sql.includes("SELECT 1 FROM farmetrica.nomenclator_presentaciones"))
   return {rows:[{exist:1}]};
  if(sql.includes("SELECT cn,nombre,laboratorio"))
   return {rows:[{cn:"654321",nombre:"Amoxicilina",generico:true}]};
  if(sql.includes("SELECT n.cn")&&sql.includes(".fm_ventas_analitica"))
   return {rows:[{cn:"654321",units:25,revenue:125}]};
  if(sql.includes("SELECT n.cn")&&sql.includes(".fm_recepciones_analitica"))
   return {rows:[{cn:"654321",supplierCode:"2",supplier:"Laboratorio B",units:20,spend:30,puc:1.5}]};
  throw Error("Query inesperada: "+sql.slice(0,180));
 }};
 setupGenericAnalytics(app,pool,{requireTenantModule:()=>[]});
 const request={
  query:{desde:"2026-10-01",hasta:"2026-10-18",farmacias:"1",...(withSearch?{buscar:"Amoxicilina"}:{})},
  context:{client:{slug:"ampedia",schema:"ampedia"},
   allowedPharmacyIds:[1]},params:{dcpf:"10531000140107"}
 };
 async function invoke(route,req=request){
  let status=200,body;
  const res={status(n){status=n;return res},json(value){body=value;return res}};
  let err;await routes[route](req,res,e=>{err=e});
  if(err)throw err;
  return {status,body};
 }
 return {invoke,calls,request};
}

test("consulta de conjuntos agrupa los CN y recupera compras y ventas con parámetros válidos",async()=>{
 const {invoke,calls}=fixture();
 const {status,body}=await invoke("/api/genericos/conjuntos");
 assert.equal(status,200);
 assert.equal(body.totalGroups,1);
 assert.equal(body.groups[0].skuCount,3);
 assert.equal(body.groups[0].salesUnits,25);
 assert.equal(body.groups[0].averagePuc,1.5);
 assert.equal(body.summary.purchases,30);
 const sale=calls.find(c=>c.sql.includes("SELECT n.dcpf")&&c.sql.includes(".fm_ventas_analitica"));
 const buy=calls.find(c=>c.sql.includes("SELECT n.dcpf")&&c.sql.includes(".fm_recepciones_analitica"));
 assert.deepEqual(sale.params,["2026-10-01","2026-10-18",[1],"ampedia"]);
 assert.deepEqual(buy.params,["2026-10-01","2026-10-18",[1],"ampedia"]);
 assert.match(sale.sql,/farmetrica\.farmacias f ON f\.cliente_slug=\$4/);
 assert.match(buy.sql,/f\.id=ANY\(\$3::int\[\]\)/);
});
test("el filtro de texto conserva los movimientos de todos los CN del conjunto",async()=>{
 const {invoke,calls}=fixture({withSearch:true});
 const {body}=await invoke("/api/genericos/conjuntos");
 assert.equal(body.groups.length,1);
 const sale=calls.find(c=>c.sql.includes("SELECT n.dcpf")&&c.sql.includes(".fm_ventas_analitica"));
 assert.doesNotMatch(sale.sql,/ILIKE/);
});
test("detalle DCPF muestra proveedores sin mezclar clientes",async()=>{
 const {invoke,calls}=fixture();
 const {body}=await invoke("/api/genericos/conjuntos/:dcpf");
 assert.equal(body.products.length,1);
 assert.equal(body.purchases[0].puc,1.5);
 const purchase=calls.find(c=>c.sql.includes("SELECT n.cn")&&c.sql.includes(".fm_recepciones_analitica"));
 const sale=calls.find(c=>c.sql.includes("SELECT n.cn")&&c.sql.includes(".fm_ventas_analitica"));
 assert.deepEqual(purchase.params,["2026-10-01","2026-10-18",[1],"10531000140107","ampedia"]);
 assert.deepEqual(sale.params,["2026-10-01","2026-10-18",[1],"10531000140107","ampedia"]);
});
test("rechaza acceso a farmacias que el usuario no tiene asignadas",async()=>{
 const {invoke,request}=fixture();
 const {status,body}=await invoke("/api/genericos/conjuntos",{
  ...request,query:{...request.query,farmacias:"2"}
 });
 assert.equal(status,403);
 assert.match(body.error,/no autorizadas/i);
});
