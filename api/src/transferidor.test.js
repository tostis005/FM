import test from "node:test";
import assert from "node:assert/strict";
import {buildGlobalTransfers,parseTransferFilters,filterTransferPlan,setupTransferidor,
 transferidorInventorySQL,transferidorSalesSQL,transferidorCNChunks,mergeTransferBatch} from "./transferidor.js";

const pharmacies=[{id:"1",name:"Abadía"},{id:"2",name:"Europa"},{id:"3",name:"Centro"},{id:"4",name:"Norte"}];

async function awaitTransferResult(handler,req,res){
 for(let i=0;i<100;i++){
  let error;
  await handler(req,res,e=>{error=e});
  if(error)throw error;
  if(!["queued","inventory","calculating"].includes(res.body?.status))return res.body;
  await new Promise(resolve=>setTimeout(resolve,2));
 }
 throw Error("El cálculo de prueba no terminó");
}

const item=(pharmacyId,cn,stock,target)=>({
 pharmacyId,cn,name:"Parafarmacia",stock,units3:0,units12:target*365/20,ordered:0
});

test("redistribuye globalmente un CN sin asignar dos veces las mismas unidades",()=>{
 const result=buildGlobalTransfers([
  item("1","123456",2,5),item("2","123456",8,2),
  item("3","123456",1,4),item("4","123456",0,0)
 ],pharmacies,20);
 assert.equal(result.transfers.reduce((n,t)=>n+t.units,0),6);
 assert.deepEqual(result.transfers.map(t=>[t.originId,t.destinationId,t.units]),
  [["2","1",3],["2","3",3]]);
 assert.ok(result.transfers.every(t=>t.originId!==t.destinationId));
 assert.equal(result.skipped,0);
});

test("medicación queda fuera y el stock nulo se considera cero",()=>{
 const result=buildGlobalTransfers([
  item("1","500001",10,0),item("2","500001",0,9),
  item("1","123457",null,2),item("2","123457",10,0),
  item("1","123458",6.5,0),item("2","123458",0,4)
 ],pharmacies.slice(0,2),20);
 assert.deepEqual(result.transfers.map(x=>x.cn),["123457","123458"]);
 assert.equal(result.transfers[0].units,2);
 assert.equal(result.transfers[1].units,4);
 assert.equal(result.skipped,0);
});

test("filtra todos, envío, recepción y farmacia de origen/destino sobre plan global",()=>{
 const plan=buildGlobalTransfers([
  item("1","123456",1,5),item("2","123456",12,1),item("3","123456",0,5)
 ],pharmacies.slice(0,3),20).transfers;
 const opts=raw=>parseTransferFilters({pagina:1,tamano:10,...raw},pharmacies.slice(0,3));
 assert.equal(filterTransferPlan(plan,opts({vista:"recibo",farmacia:"3"})).total,1);
 assert.equal(filterTransferPlan(plan,opts({vista:"envio",farmacia:"1"})).total,0);
 assert.equal(filterTransferPlan(plan,opts({origen:"2",destino:"1"})).total,1);
 assert.equal(filterTransferPlan(plan,opts({vista:"todos",farmacia:"2"})).total,2);
 assert.throws(()=>opts({origen:"9"}),/filtros|farmacia/);
 assert.throws(()=>opts({filtros:'{"__proto__":"x"}'}),/filtros|farmacia/);
});

test("dos donantes y dos receptores mantienen saldos globales coherentes",()=>{
 const rows=[item("1","123459",6,1),item("2","123459",7,2),
  item("3","123459",0,8),item("4","123459",1,7)];
 const plan=buildGlobalTransfers(rows,pharmacies,20).transfers;
 assert.equal(plan.reduce((n,r)=>n+r.units,0),10);
 for(const [id,available] of [["1",5],["2",5]]){
  assert.ok(plan.filter(r=>r.originId===id).reduce((n,r)=>n+r.units,0)<=available);
 }
 assert.equal(plan.filter(r=>r.destinationId==="3").reduce((n,r)=>n+r.units,0),8);
 assert.equal(plan.filter(r=>r.destinationId==="4").reduce((n,r)=>n+r.units,0),2);
 const page=filterTransferPlan(plan,parseTransferFilters({pagina:"2",tamano:"10",
  orden:"units",direccion:"desc"},pharmacies));
 assert.equal(page.total,plan.length,"El total se cuenta antes de paginar");
});

test("la API permite leer resultados de dos farmacias aunque falte una tercera",async()=>{
 const queries=[];
 const db={async query(arg){
  const sql=typeof arg==="string"?arg:arg.text;
  queries.push({sql,values:typeof arg==="string"?[]:arg.values});
  if(sql.includes("WITH chosen AS MATERIALIZED"))return {rows:[
   {pharmacyId:"1",sourceCode:"ABA",articleId:"123456",cn:"123456",name:"Crema",stock:20},
   {pharmacyId:"2",sourceCode:"EUR",articleId:"123456",cn:"123456",name:"Crema",stock:0}
  ]};
  if(sql.includes("WITH refs AS MATERIALIZED"))return {rows:[
   {pharmacyId:"2",articleId:"123456",units7:7}
  ]};
  if(sql.includes("FROM farmetrica.op_pedidos"))return {rows:[]};
  if(sql.includes("transferidor_configuracion_cliente"))return {rows:[{minDays:1,targetDays:20}]};
  if(sql.includes("transferidor_exposicion_"))return {rows:[]};
  throw Error("SQL no previsto: "+sql.slice(0,100));
 }};
 let handler;
 setupTransferidor({get(path,...stack){
  assert.equal(path,"/api/analytics/stock/transferidor");
  handler=stack.at(-1);
 }},db,{requireTenant:()=>[]});
 const req={context:{role:"superadministrador",client:{slug:"testmissingpharmacy",schema:"ampedia"},
  pharmacies:pharmacies.slice(0,3)},query:{vista:"todos",pagina:"1",tamano:"50"}};
 const res={statusCode:200,status(n){this.statusCode=n;return this;},
  json(value){this.body=value;return this;}};
 const body=await awaitTransferResult(handler,req,res);
 assert.equal(res.statusCode,200);
 assert.equal(body.status,"complete");
 assert.equal(body.total,1);
 assert.equal(body.rows[0].originName,"Abadía");
 assert.equal(body.rows[0].destinationName,"Europa");
 assert.equal(body.rows[0].units,20);
 assert.match(body.warning,/Centro/);
 assert.equal(queries.filter(q=>q.sql.includes("WITH chosen AS MATERIALIZED")).length,1);
 assert.equal(queries.filter(q=>q.sql.includes("WITH refs AS MATERIALIZED")).length,1);
});
test("frontera IdArticu 399999 parafarmacia; 400000 medicación",()=>{
 const result=buildGlobalTransfers([
  item("1","399999",60,0),item("2","399999",0,10),
  item("1","400000",60,0),item("2","400000",0,10)
 ],pharmacies.slice(0,2),20);
 assert.deepEqual(result.transfers.map(t=>t.cn),["399999"]);
});
test("objetivo predeterminado de 7 días para el transferidor",()=>{
 const records=[{pharmacyId:"1",cn:"123456",name:"Crema",stock:40,units3:0,units12:0},
 {pharmacyId:"2",cn:"123456",name:"Crema",stock:0,units3:90,units12:90}];
 const plan=buildGlobalTransfers(records,pharmacies.slice(0,2));
 assert.equal(plan.transfers.length,1);
 assert.equal(plan.transfers[0].units,7);
});


test("dispara con menos de 4 días y repone hasta 7, sin microtransferencias",()=>{
 const all=[
  {pharmacyId:"1",cn:"123456",stock:4,units12:365,name:"Crema"},
  {pharmacyId:"2",cn:"123456",stock:40,units12:0,name:"Crema"}
 ];
 assert.equal(buildGlobalTransfers(all,pharmacies.slice(0,2)).transfers.length,0);
 all[0].stock=3;
 const plan=buildGlobalTransfers(all,pharmacies.slice(0,2));
 assert.equal(plan.transfers.length,1);
 assert.equal(plan.transfers[0].units,4);
 assert.equal(plan.transfers[0].triggerDestination,4);
 assert.equal(plan.transfers[0].targetDestination,7);
});
test("30 días de exposición se añaden a 4/7 días; no se quitan del donante",()=>{
 const rows=[
  {pharmacyId:"1",cn:"123456",stock:33,units12:365,name:"Crema",familyId:"5"},
  {pharmacyId:"2",cn:"123456",stock:150,units12:0,name:"Crema",familyId:"5"}
 ];
 const plan=buildGlobalTransfers(rows,pharmacies.slice(0,2),{
  minDays:4,targetDays:7,
  families:[{pharmacyId:"1",familyId:"5",days:30},{pharmacyId:"2",familyId:"5",days:30}],
  articles:[{pharmacyId:"2",cn:"123456",units:100}]
 });
 assert.equal(plan.transfers.length,1);
 assert.equal(plan.transfers[0].triggerDestination,34);
 assert.equal(plan.transfers[0].targetDestination,37);
 assert.equal(plan.transfers[0].extraDestination,30);
 assert.equal(plan.transfers[0].units,4);
 // La farmacia 2 mantiene sus 100 unidades de exposición: sólo dona 50.
 rows[0].stock=0;
 assert.equal(buildGlobalTransfers(rows,pharmacies.slice(0,2),{
  minDays:4,targetDays:7,families:[{pharmacyId:"1",familyId:"5",days:30}],
  articles:[{pharmacyId:"2",cn:"123456",units:100}]
 }).transfers[0].units,37);
});
test("una reserva de CN reemplaza la reserva de familia y sirve sin ventas",()=>{
 const rows=[
  {pharmacyId:"1",cn:"123456",stock:99,units12:0,name:"Crema",familyId:"5"},
  {pharmacyId:"2",cn:"123456",stock:105,units12:0,name:"Crema",familyId:"5"}
 ];
 const plan=buildGlobalTransfers(rows,pharmacies.slice(0,2),{
  minDays:4,targetDays:7,families:[{pharmacyId:"1",familyId:"5",days:30}],
  articles:[{pharmacyId:"1",cn:"123456",units:100}]
 });
 assert.equal(plan.transfers[0].units,1);
 assert.equal(plan.transfers[0].extraDestination,100);
 assert.equal(plan.transfers[0].reserveSource,"articulo");
});

test("acepta CN de siete dígitos, normaliza a seis y agrupa la misma referencia",()=>{
 const rows=[
  {pharmacyId:"1",cn:"1234567",stock:40,units12:0,name:"Crema"},
  {pharmacyId:"2",cn:"123456",stock:0,units12:365,name:"Crema"}
 ];
 const plan=buildGlobalTransfers(rows,pharmacies.slice(0,2));
 assert.equal(plan.transfers.length,1);
 assert.equal(plan.transfers[0].cn,"123456");
 assert.equal(plan.transfers[0].units,7);
});
test("inventario y ventas se leen por separado, únicamente última semana",()=>{
 const stock=transferidorInventorySQL("ampedia");
 const sales=transferidorSalesSQL("ampedia");
 assert.match(stock,/catalog AS MATERIALIZED/);
 assert.match(stock,/a\.codigo_nacional/);
 assert.match(stock,/a\.origen_id::text AS article_id/);
 assert.match(stock,/JOIN donors d ON d\.cn=a\.cn/);
 assert.ok(!stock.includes("fm_ventas_lineas"));
 assert.match(sales,/l\.articulo_origen_id=r\.article_id/);
 assert.match(sales,/interval '6 days'/);
 assert.ok(!sales.includes("364 days"));
 assert.ok(!sales.includes("89 days"));
 assert.ok(!sales.includes("fm_ventas_analitica"));
});
test("cada lote mantiene un CN completo y la suma de existencias por farmacia",()=>{
 const entries=[
  {cn:"123456",pharmacyId:"1",articleId:"ABC",sourceCode:"ABA",stock:4},
  {cn:"123456",pharmacyId:"1",articleId:"DEF",sourceCode:"ABA",stock:6},
  {cn:"123456",pharmacyId:"2",articleId:"XYZ",sourceCode:"EUR",stock:0},
  {cn:"123457",pharmacyId:"1",articleId:"789",sourceCode:"ABA",stock:20}
 ];
 const chunks=transferidorCNChunks(entries,3);
 assert.equal(chunks.length,2);
 assert.equal(chunks.flat().length,entries.length);
 assert.ok(chunks.every(part=>new Set(part.map(x=>x.cn)).size===1));
 const combined=mergeTransferBatch(entries.slice(0,3),[
  {pharmacyId:"1",articleId:"ABC",units7:7},
  {pharmacyId:"1",articleId:"DEF",units7:3},
  {pharmacyId:"2",articleId:"XYZ",units7:14}
 ],new Map());
 assert.equal(combined.length,2);
 assert.equal(combined.find(x=>x.pharmacyId==="1").stock,10);
 assert.equal(combined.find(x=>x.pharmacyId==="1").units7,10);
 assert.equal(combined.find(x=>x.pharmacyId==="2").units7,14);
});
test("siete ventas en una semana equivalen a una unidad diaria",()=>{
 const plan=buildGlobalTransfers([
  {pharmacyId:"1",cn:"123456",stock:30,units7:0,name:"Crema"},
  {pharmacyId:"2",cn:"123456",stock:0,units7:7,name:"Crema"}
 ],pharmacies.slice(0,2));
 assert.equal(plan.transfers.length,1);
 assert.equal(plan.transfers[0].units,7);
});
test("progreso: no repite el inventario y devuelve los movimientos al finalizar",async()=>{
 const calls=[];
 const query=async arg=>{
  const sql=typeof arg==="string"?arg:arg.text;
  calls.push(sql);
  if(sql.includes("WITH chosen AS MATERIALIZED"))return {rows:[
   {pharmacyId:"1",cn:"123456",sourceCode:"ABA",articleId:"123456",stock:30,name:"Crema"},
   {pharmacyId:"2",cn:"123456",sourceCode:"EUR",articleId:"123456",stock:0,name:"Crema"}
  ]};
  if(sql.includes("WITH refs AS MATERIALIZED"))
   return {rows:[{pharmacyId:"2",articleId:"123456",units7:7}]};
  if(sql.includes("FROM farmetrica.op_pedidos"))return {rows:[]};
  if(sql.includes("transferidor_configuracion_cliente"))
   return {rows:[{minDays:4,targetDays:7}]};
  if(sql.includes("transferidor_exposicion_"))return {rows:[]};
  if(/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL)/.test(sql))return {rows:[]};
  throw Error("SQL imprevisto: "+sql.slice(0,70));
 };
 const db={query,release(){calls.push("RELEASE")}};
 const pool={query,connect:async()=>db};
 let handler;
 setupTransferidor({get(_path,...stack){handler=stack.at(-1)}},pool,{requireTenant:()=>[]});
 const req={query:{pagina:"1",tamano:"50"},
  context:{role:"superadministrador",client:{slug:"testprogress",schema:"testprogress"},
   pharmacies:pharmacies.slice(0,2)}};
 const res={statusCode:200,status(n){this.statusCode=n;return this},
  json(value){this.body=value;return this}};
 const body=await awaitTransferResult(handler,req,res);
 assert.equal(res.statusCode,200);
 assert.equal(body.status,"complete");
 assert.equal(body.total,1);
 assert.equal(body.rows[0].units,7);
 assert.equal(calls.filter(x=>x.includes("WITH chosen AS MATERIALIZED")).length,1);
 assert.equal(calls.filter(x=>x.includes("WITH refs AS MATERIALIZED")).length,1);
 assert.ok(calls.includes("BEGIN READ ONLY"));
 assert.ok(calls.includes("SET LOCAL statement_timeout='60s'"));
 assert.ok(calls.includes("COMMIT"));
 assert.ok(calls.includes("RELEASE"));
});
test("si PostgreSQL cancela el inventario el estado informa el error",async()=>{
 const query=async arg=>{
  const sql=typeof arg==="string"?arg:arg.text;
  if(sql.includes("WITH chosen AS MATERIALIZED"))
   throw Object.assign(Error("canceling statement due to statement timeout"),{code:"57014"});
  if(/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL)/.test(sql))return {rows:[]};
  if(sql.includes("transferidor_configuracion_cliente"))return {rows:[{}]};
  if(sql.includes("transferidor_exposicion_"))return {rows:[]};
  return {rows:[]};
 };
 let released=false;
 const pool={query,connect:async()=>({query,release(){released=true}})};
 let handler;
 setupTransferidor({get(_path,...stack){handler=stack.at(-1)}},pool,{requireTenant:()=>[]});
 const req={query:{pagina:"1",tamano:"50"},
  context:{role:"superadministrador",client:{slug:"testfailure",schema:"testfailure"},
   pharmacies:pharmacies.slice(0,2)}};
 const res={statusCode:200,status(n){this.statusCode=n;return this},
  json(value){this.body=value;return this}};
 const body=await awaitTransferResult(handler,req,res);
 assert.equal(res.statusCode,503);
 assert.equal(body.status,"error");
 assert.match(body.error,/tiempo|índices/);
 assert.equal(released,true);
});
test("sin tablas de ventas no se muestra una tabla vacía sin explicar el error",async()=>{
 const query=async arg=>{
  const sql=typeof arg==="string"?arg:arg.text;
  if(sql.includes("WITH chosen AS MATERIALIZED"))
   throw Object.assign(Error("relation not found"),{code:"42P01"});
  if(sql.includes("transferidor_configuracion_cliente"))return {rows:[{}]};
  if(sql.includes("transferidor_exposicion_"))return {rows:[]};
  return {rows:[]};
 };
 const pool={query,connect:async()=>({query,release(){}})};
 let handler;
 setupTransferidor({get(_path,...stack){handler=stack.at(-1)}},pool,{requireTenant:()=>[]});
 const req={query:{pagina:"1",tamano:"50"},
  context:{role:"superadministrador",client:{slug:"testabsent",schema:"testabsent"},
   pharmacies:pharmacies.slice(0,2)}};
 const res={statusCode:200,status(n){this.statusCode=n;return this},
  json(value){this.body=value;return this}};
 const body=await awaitTransferResult(handler,req,res);
 assert.equal(res.statusCode,503);
 assert.equal(body.status,"error");
 assert.match(body.error,/sincronización/);
});

test("el cliente recibe propuestas parciales antes de terminar todos los lotes",async()=>{
 const articles=[];
 for(let i=0;i<351;i++){
  const cn=String(100000+i);
  articles.push({cn,pharmacyId:"1",sourceCode:"ABA",articleId:cn,stock:30,name:"Crema"});
  articles.push({cn,pharmacyId:"2",sourceCode:"EUR",articleId:cn,stock:0,name:"Crema"});
 }
 let unblock;
 const gate=new Promise(resolve=>{unblock=resolve});
 let salesCount=0;
 const query=async arg=>{
  const sql=typeof arg==="string"?arg:arg.text;
  if(sql.includes("WITH chosen AS MATERIALIZED"))return {rows:articles};
  if(sql.includes("WITH refs AS MATERIALIZED")){
   salesCount++;
   if(salesCount===2)await gate;
   return {rows:JSON.parse(arg.values[0]).filter(r=>r.fid==="2")
    .map(r=>({pharmacyId:"2",articleId:r.article_id,units7:7}))};
  }
  if(sql.includes("FROM farmetrica.op_pedidos"))return {rows:[]};
  if(sql.includes("transferidor_configuracion_cliente"))return {rows:[{minDays:4,targetDays:7}]};
  if(sql.includes("transferidor_exposicion_"))return {rows:[]};
  throw Error("SQL inesperado: "+sql.slice(0,50));
 };
 let handler;
 setupTransferidor({get(_path,...stack){handler=stack.at(-1)}},{query},{requireTenant:()=>[]});
 const req={query:{pagina:"1",tamano:"50"},
  context:{role:"superadministrador",client:{slug:"testpartial",schema:"testpartial"},
   pharmacies:pharmacies.slice(0,2)}};
 const res={statusCode:200,status(n){this.statusCode=n;return this},
  json(value){this.body=value;return this}};
 try{
  let observed=false;
  for(let i=0;i<100;i++){
   await handler(req,res,err=>{if(err)throw err});
   if(res.body?.status==="calculating"&&res.body?.progress?.done===1){
    observed=true;break;
   }
   await new Promise(resolve=>setTimeout(resolve,2));
  }
  assert.ok(observed,"Debe publicar el primer lote antes de completar el segundo");
  assert.equal(res.body.progress.total,2);
  assert.equal(res.body.total,350);
 }finally{unblock()}
 const body=await awaitTransferResult(handler,req,res);
 assert.equal(body.status,"complete");
 assert.equal(body.total,351);
 assert.equal(salesCount,2);
});
