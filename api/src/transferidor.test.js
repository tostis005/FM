import test from "node:test";
import assert from "node:assert/strict";
import {buildGlobalTransfers,parseTransferFilters,filterTransferPlan,setupTransferidor,
 transferidorInventorySQL,transferidorSalesSQL,transferidorPendingWebSQL,
 transferidorCNChunks,mergeTransferBatch,processTransferChunks} from "./transferidor.js";

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
   {pharmacyId:"1",articleId:"123456",units7:0,units30:3},
   {pharmacyId:"2",articleId:"123456",units7:7,units30:25}
  ]};
  if(sql.includes("FROM farmetrica.picking_list_pendientes"))return {rows:[]};
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
 assert.equal(body.rows[0].sales7Origin,0);
 assert.equal(body.rows[0].sales7Destination,7);
 assert.equal(body.rows[0].sales30Origin,3);
 assert.equal(body.rows[0].sales30Destination,25);
 assert.match(body.warning,/Centro/);
 assert.equal(queries.filter(q=>q.sql.includes("WITH chosen AS MATERIALIZED")).length,1);
 assert.equal(queries.filter(q=>q.sql.includes("WITH refs AS MATERIALIZED")).length,1);
 assert.equal(queries.filter(q=>q.sql.includes('AS "units30"')).length,1);
});

test("la propuesta expone pedidos pendientes del destino para explicar unidades a enviar",()=>{
 const plan=buildGlobalTransfers([
  {pharmacyId:"1",cn:"123456",name:"Crema",stock:28,units7:0},
  {pharmacyId:"2",cn:"123456",name:"Crema",stock:1,ordered:2,units7:7}
 ],pharmacies.slice(0,2));
 assert.equal(plan.transfers.length,1);
 const move=plan.transfers[0];
 assert.equal(move.pendingDestination,2);
 assert.equal(move.stockDestination,1);
 assert.equal(move.triggerDestination,4);
 assert.equal(move.targetDestination,7);
 assert.equal(move.units,4,"Se envía objetivo 7 menos stock 1 y pedidos pendientes 2");
 const filtered=filterTransferPlan(plan.transfers,
  parseTransferFilters({orden:"pendingDestination",filtros:'{"pendingDestination":"2"}'},
   pharmacies.slice(0,2)));
 assert.equal(filtered.total,1,"Permite filtrar y ordenar por pendientes");
});

test("una exposición extra se muestra dentro del objetivo, sin variar la previsión mínima",()=>{
 const plan=buildGlobalTransfers([
  {pharmacyId:"1",cn:"123456",name:"Crema",stock:35,units7:0},
  {pharmacyId:"2",cn:"123456",name:"Crema",stock:0,units7:7,ordered:0}
 ],pharmacies.slice(0,2),{
  minDays:4,targetDays:7,articles:[{pharmacyId:"2",cn:"123456",units:6}],families:[]
 });
 assert.equal(plan.transfers.length,1);
 assert.equal(plan.transfers[0].triggerDestination,4);
 assert.equal(plan.transfers[0].targetDestination,13);
 assert.equal(plan.transfers[0].extraDestination,6);
 assert.equal(plan.transfers[0].units,13);
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
  {pharmacyId:"1",cn:"123456",stock:3,units12:365,name:"Crema",familyId:"5"},
  {pharmacyId:"2",cn:"123456",stock:150,units12:0,name:"Crema",familyId:"5"}
 ];
 const plan=buildGlobalTransfers(rows,pharmacies.slice(0,2),{
  minDays:4,targetDays:7,
  families:[{pharmacyId:"1",familyId:"5",days:30},{pharmacyId:"2",familyId:"5",days:30}],
  articles:[{pharmacyId:"2",cn:"123456",units:100}]
 });
 assert.equal(plan.transfers.length,1);
 assert.equal(plan.transfers[0].triggerDestination,4);
 assert.equal(plan.transfers[0].targetDestination,37);
 assert.equal(plan.transfers[0].extraDestination,30);
 assert.equal(plan.transfers[0].units,34);
 // La farmacia 2 mantiene sus 100 unidades de exposición: sólo dona 50.
 rows[0].stock=0;
 assert.equal(buildGlobalTransfers(rows,pharmacies.slice(0,2),{
  minDays:4,targetDays:7,families:[{pharmacyId:"1",familyId:"5",days:30}],
  articles:[{pharmacyId:"2",cn:"123456",units:100}]
 }).transfers[0].units,37);
});
test("exposición por CN nunca genera transferencia sin déficit por ventas",()=>{
 const rows=[
  {pharmacyId:"1",cn:"123456",stock:99,units7:0,name:"Crema",familyId:"5"},
  {pharmacyId:"2",cn:"123456",stock:150,units7:0,name:"Crema",familyId:"5"}
 ];
 const policy={
  minDays:4,targetDays:7,families:[{pharmacyId:"1",familyId:"5",days:30}],
  articles:[{pharmacyId:"1",cn:"123456",units:100}]
 };
 const withoutSales=buildGlobalTransfers(rows,pharmacies.slice(0,2),policy);
 assert.equal(withoutSales.transfers.length,0);
 assert.equal(withoutSales.withNeed,0);
 // Una vez que el destino realmente necesita stock, se respeta la reserva.
 rows[0].stock=0;
 rows[0].units7=7;
 const withSales=buildGlobalTransfers(rows,pharmacies.slice(0,2),policy);
 assert.equal(withSales.transfers.length,1);
 assert.equal(withSales.transfers[0].units,107);
 assert.equal(withSales.transfers[0].extraDestination,100);
 assert.equal(withSales.transfers[0].reserveSource,"articulo");
});

test("excedente en origen no basta para proponer un envío",()=>{
 const rows=[
  {pharmacyId:"1",cn:"123456",stock:500,units7:0,name:"Crema"},
  {pharmacyId:"2",cn:"123456",stock:12,units7:7,name:"Crema"}
 ];
 const result=buildGlobalTransfers(rows,pharmacies.slice(0,2));
 assert.equal(result.withSurplus,1);
 assert.equal(result.withNeed,0);
 assert.equal(result.transfers.length,0);
});

test("si el destino cubre el mínimo de ventas no se transfiere para rellenar exposición",()=>{
 const rows=[
  {pharmacyId:"1",cn:"123456",stock:150,units7:0,name:"Crema"},
  {pharmacyId:"2",cn:"123456",stock:5,units7:7,name:"Crema",familyId:"10"}
 ];
 const result=buildGlobalTransfers(rows,pharmacies.slice(0,2),{
  minDays:4,targetDays:7,
  families:[{pharmacyId:"2",familyId:"10",days:20}],articles:[]
 });
 assert.equal(result.transfers.length,0);
 assert.equal(result.withNeed,0);
});

test("las ventas previstas y los pedidos pendientes determinan la necesidad real",()=>{
 const rows=[
  {pharmacyId:"1",cn:"123456",stock:30,units7:0,name:"Crema"},
  {pharmacyId:"2",cn:"123456",stock:3,units7:7,ordered:1,name:"Crema"}
 ];
 assert.equal(buildGlobalTransfers(rows,pharmacies.slice(0,2)).transfers.length,0,
  "Tres unidades más una pendiente cubren cuatro días de ventas");
 rows[1].ordered=0;
 const result=buildGlobalTransfers(rows,pharmacies.slice(0,2));
 assert.equal(result.transfers.length,1);
 assert.equal(result.transfers[0].units,4);
 assert.equal(result.transfers[0].triggerDestination,4);
 assert.equal(result.transfers[0].targetDestination,7);
});

test("el stock de seguridad del donante limita las unidades propuestas",()=>{
 const rows=[
  {pharmacyId:"1",cn:"123456",stock:8,units7:7,name:"Crema"},
  {pharmacyId:"2",cn:"123456",stock:0,units7:14,name:"Crema"}
 ];
 const result=buildGlobalTransfers(rows,pharmacies.slice(0,2));
 assert.equal(result.withNeed,1);
 assert.equal(result.withSurplus,1);
 assert.equal(result.transfers[0].units,1,
  "Donante mantiene siete unidades para siete días de sus propias ventas");
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

test("API incorpora ALMACEN como origen aunque el perfil solo seleccione farmacias",async()=>{
 const queries=[];
 const db={async query(arg){
  const sql=typeof arg==="string"?arg:arg.text;
  queries.push(sql);
  if(sql.includes("WITH chosen AS MATERIALIZED"))return {rows:[
   {cn:"123456",pharmacyId:"1",sourceCode:"ABA",articleId:"111111",stock:0,name:"Crema",kind:"farmacia"},
   {cn:"123456",pharmacyId:"2",sourceCode:"EUR",articleId:"222222",stock:0,name:"Crema",kind:"farmacia"},
   {cn:"123456",pharmacyId:"9",sourceCode:"ALMACEN",articleId:"333333",stock:50,
    name:"Crema",kind:"almacen",siteName:"ALM"}
  ]};
  if(sql.includes("WITH refs AS MATERIALIZED"))return {rows:[
   {pharmacyId:"1",articleId:"111111",units7:7,units30:30},
   {pharmacyId:"9",articleId:"333333",units7:0,units30:0}
  ]};
  if(sql.includes("FROM farmetrica.picking_list_pendientes"))
   return {rows:[{cn:"123456",units:2}]};
  if(sql.includes("FROM farmetrica.op_pedidos"))return {rows:[]};
  if(sql.includes("transferidor_configuracion_cliente"))return {rows:[{minDays:4,targetDays:7}]};
  if(sql.includes("transferidor_exposicion_"))return {rows:[]};
  throw Error("SQL inesperado: "+sql.slice(0,90));
 }};
 let handler;
 setupTransferidor({get(_p,...args){handler=args.at(-1)}},db,{requireTenant:()=>[]});
 const req={query:{pagina:1,tamano:50},
  context:{role:"superadministrador",modules:{stock:true},
   client:{slug:"testwarehouseapi",schema:"ampedia"},
   pharmacies:pharmacies.slice(0,2)}};
 const res={statusCode:200,status(n){this.statusCode=n;return this},
  json(body){this.body=body;return this}};
 const body=await awaitTransferResult(handler,req,res);
 assert.equal(body.status,"complete");
 assert.equal(body.warehouseAvailable,true);
 assert.equal(body.total,1);
 assert.equal(body.rows[0].originKind,"almacen");
 assert.equal(body.rows[0].originName,"ALM");
 assert.equal(body.rows[0].originId,"9");
 assert.equal(body.rows[0].units,7);
 assert.equal(body.rows[0].targetOrigin,11);
 assert.equal(body.rows[0].sales30Destination,30);
 assert.equal(queries.filter(q=>q.includes("WITH refs AS MATERIALIZED")).length,1);
 req.query={...req.query,origen:"almacen"};
 const filtered=await awaitTransferResult(handler,req,res);
 assert.equal(filtered.total,1);
});

test("sin farmacia seleccionada las tres vistas se normalizan a todos",()=>{
 const all=parseTransferFilters({vista:"todos"},pharmacies);
 const sends=parseTransferFilters({vista:"envio"},pharmacies);
 const receives=parseTransferFilters({vista:"recibo"},pharmacies);
 assert.equal(all.vista,"todos");
 assert.equal(sends.vista,"todos");
 assert.equal(receives.vista,"todos");
 assert.equal(parseTransferFilters({vista:"envio",farmacia:"1"},pharmacies).vista,"envio");
 assert.equal(parseTransferFilters({vista:"recibo",farmacia:"2"},pharmacies).vista,"recibo");
});

test("el almacén no protege toda la rotación agregada de la red como si fuera suya",()=>{
 const wh={id:"9",name:"ALM",establishmentType:"almacen"};
 const result=buildGlobalTransfers([
  {pharmacyId:"1",cn:"123456",stock:0,units7:14,units30:60},
  {pharmacyId:"2",cn:"123456",stock:10,units7:7,units30:30},
  {pharmacyId:"3",cn:"123456",stock:10,units7:7,units30:30},
  {pharmacyId:"9",cn:"123456",stock:60,units7:0,units30:0}
 ],[...pharmacies.slice(0,3),wh]);
 const move=result.transfers.find(t=>t.originId==="9");
 assert.ok(move,"El almacén debe poder aportar excedentes");
 assert.equal(move.warehousePharmacyReserve,8,"Una farmacia de mayor rotación, 4d");
 assert.equal(move.warehouseWebReserve,14,"Sin salidas web, referencia de una farmacia, 7d");
 assert.equal(move.targetOrigin,22,"No se atribuyen 11 días de toda la red");
 assert.equal(move.warehouseWebEstimate,true);
});

test("el histórico del almacén y pedidos web prevalecen frente a previsión sustitutiva",()=>{
 const wh={id:"9",name:"ALM",establishmentType:"almacen"};
 const result=buildGlobalTransfers([
  {pharmacyId:"1",cn:"123456",stock:0,units7:14,units30:60},
  {pharmacyId:"2",cn:"123456",stock:10,units7:7,units30:30},
  {pharmacyId:"9",cn:"123456",stock:100,units7:21,units30:60}
 ],[...pharmacies.slice(0,2),wh],{minDays:4,targetDays:7,
  families:[],articles:[],webPendingByCn:new Map([["123456",25]])});
 const move=result.transfers.find(t=>t.originId==="9");
 assert.ok(move);
 assert.equal(move.warehouseWebEstimate,false);
 assert.equal(move.warehouseWebReserve,25);
 assert.equal(move.warehousePharmacyReserve,8);
 assert.equal(move.targetOrigin,33);
});

test("los lotes paralelos procesan cada CN una sola vez y respetan el límite de concurrencia",async()=>{
 const all=Array.from({length:8},(_,i)=>i);
 const started=[],done=[];
 let concurrent=0,peak=0;
 await processTransferChunks(all,async id=>{
  started.push(id);concurrent++;peak=Math.max(peak,concurrent);
  await new Promise(resolve=>setTimeout(resolve,2));
  concurrent--;done.push(id);
 },{concurrency:2});
 assert.equal(peak,2);
 assert.equal(new Set(started).size,8);
 assert.deepEqual(started.slice().sort((a,b)=>a-b),all);
 assert.deepEqual(done.slice().sort((a,b)=>a-b),all);
});

test("los lotes no propagan error hasta que terminan los demás trabajadores",async()=>{
 const seen=[];
 let error;
 try{
  await processTransferChunks([0,1,2],async n=>{
   await new Promise(resolve=>setTimeout(resolve,2));
   seen.push(n);
   if(n===0)throw Error("lote");
  },{concurrency:2});
 }catch(e){error=e}
 assert.match(String(error),/lote/);
 assert.ok(seen.includes(1),"El segundo trabajador debe terminar");
});
test("el almacén protege su reserva y se usa antes de farmacias con excedente",()=>{
 const wh={id:"9",name:"ALM",establishmentType:"almacen"};
 const entries=[
  {pharmacyId:"1",cn:"123456",stock:0,units7:7,units30:30,name:"Crema"},
  {pharmacyId:"2",cn:"123456",stock:20,units7:0,units30:0,name:"Crema"},
  {pharmacyId:"9",cn:"123456",stock:14,units7:7,units30:30,name:"Crema"}
 ];
 const policy={minDays:4,targetDays:7,families:[],articles:[]};
 const plan=buildGlobalTransfers(entries,[...pharmacies.slice(0,2),wh],policy);
 assert.equal(plan.transfers.length,2);
 assert.equal(plan.transfers[0].originId,"9");
 assert.equal(plan.transfers[0].originKind,"almacen");
 assert.equal(plan.transfers[0].warehouseWebReserve,7);
 assert.equal(plan.transfers[0].warehousePharmacyReserve,4);
 assert.equal(plan.transfers[0].targetOrigin,11);
 assert.equal(plan.transfers[0].units,3);
 assert.equal(plan.transfers[1].originId,"2");
 assert.equal(plan.transfers[1].units,4);
 assert.equal(plan.transfers.reduce((n,r)=>n+r.units,0),7);
});

test("almacén por debajo de la reserva no se utiliza, aunque tenga stock",()=>{
 const wh={id:"9",name:"ALM",establishmentType:"almacen"};
 const result=buildGlobalTransfers([
  {pharmacyId:"1",cn:"123456",stock:0,units7:7,units30:30},
  {pharmacyId:"2",cn:"123456",stock:30,units7:0,units30:0},
  {pharmacyId:"9",cn:"123456",stock:10,units7:7,units30:30}
 ],[...pharmacies.slice(0,2),wh]);
 assert.equal(result.transfers.length,1);
 assert.equal(result.transfers[0].originId,"2");
 assert.equal(result.transfers[0].units,7);
});

test("pedidos web pendientes prevalecen sobre media web y protegen stock central",()=>{
 const wh={id:"9",name:"ALM",establishmentType:"almacen"};
 const plan=buildGlobalTransfers([
  {pharmacyId:"1",cn:"123456",stock:0,units7:7,units30:30},
  {pharmacyId:"2",cn:"123456",stock:30,units7:0,units30:0},
  {pharmacyId:"9",cn:"123456",stock:56,units7:0,units30:0}
 ],[...pharmacies.slice(0,2),wh],
  {minDays:4,targetDays:7,families:[],articles:[],
   webPendingByCn:new Map([["123456",50]])});
 assert.equal(plan.transfers[0].originId,"9");
 assert.equal(plan.transfers[0].units,2);
 assert.equal(plan.transfers[0].warehouseWebReserve,50);
 assert.equal(plan.transfers[0].warehouseWebEstimate,false,"El pendiente web real no se etiqueta como estimado");
 assert.equal(plan.transfers[0].targetOrigin,54);
 assert.equal(plan.transfers[1].originId,"2");
 assert.equal(plan.transfers[1].units,5);
});

test("pedidos web pequeños sin histórico no eliminan la protección del canal online",()=>{
 const wh={id:"9",name:"ALM",establishmentType:"almacen"};
 const plan=buildGlobalTransfers([
  {pharmacyId:"1",cn:"123456",stock:0,units7:7,units30:30},
  {pharmacyId:"2",cn:"123456",stock:20,units7:0,units30:0},
  {pharmacyId:"9",cn:"123456",stock:12,units7:0,units30:0}
 ],[...pharmacies.slice(0,2),wh],{
  minDays:4,targetDays:7,families:[],articles:[],
  webPendingByCn:new Map([["123456",2]])
 });
 assert.equal(plan.transfers[0].originId,"9");
 assert.equal(plan.transfers[0].warehouseWebReserve,7);
 assert.equal(plan.transfers[0].targetOrigin,11);
 assert.equal(plan.transfers[0].units,1);
 assert.equal(plan.transfers[1].units,6);
});

test("devoluciones netas no producen demanda negativa ni liberan la reserva web",()=>{
 const wh={id:"9",name:"ALM",establishmentType:"almacen"};
 const result=buildGlobalTransfers([
  {pharmacyId:"1",cn:"123456",stock:0,units7:7,units30:30},
  {pharmacyId:"2",cn:"123456",stock:20,units7:0,units30:0},
  {pharmacyId:"9",cn:"123456",stock:10,units7:-2,units30:-5}
 ],[...pharmacies.slice(0,2),wh]);
 assert.equal(result.transfers[0].originId,"2");
 assert.equal(result.transfers[0].units,7);
});

test("sin datos de ventas web ni pedidos, conserva reserva de seguridad sustitutiva",()=>{
 const wh={id:"9",name:"ALM",establishmentType:"almacen"};
 const plan=buildGlobalTransfers([
  {pharmacyId:"1",cn:"123456",stock:0,units7:7,units30:30},
  {pharmacyId:"2",cn:"123456",stock:20,units7:0,units30:0},
  {pharmacyId:"9",cn:"123456",stock:10,units7:0,units30:0}
 ],[...pharmacies.slice(0,2),wh]);
 assert.equal(plan.transfers.length,1);
 assert.equal(plan.transfers[0].originId,"2");
});

test("almacén es origen, nunca destino, ni admite filtro de farmacia destino",()=>{
 const wh={id:"9",name:"ALM",establishmentType:"almacen"};
 const plan=buildGlobalTransfers([
  {pharmacyId:"1",cn:"123456",stock:0,units7:7,units30:30},
  {pharmacyId:"9",cn:"123456",stock:50,units7:7,units30:30}
 ],[pharmacies[0],wh]).transfers;
 assert.equal(plan.length,1);
 assert.equal(plan[0].originId,"9");
 assert.equal(plan[0].destinationId,"1");
 const opts=parseTransferFilters({origen:"almacen"},[pharmacies[0]]);
 assert.equal(filterTransferPlan(plan,opts).total,1);
 assert.throws(()=>parseTransferFilters({destino:"almacen"},[pharmacies[0]]),/filtros|farmacia/);
 assert.throws(()=>parseTransferFilters({farmacia:"almacen"},[pharmacies[0]]),/filtros|farmacia/);
});

test("ventas 7d y 30d se calculan en la misma consulta sin recorrer 12 meses",()=>{
 const sql=transferidorSalesSQL("ampedia");
 assert.match(sql,/interval '6 days'/);
 assert.match(sql,/interval '29 days'/);
 assert.ok(!sql.includes("364 days"));
 assert.ok(sql.includes('AS "units7"'));
 assert.ok(sql.includes('AS "units30"'));
 assert.ok(sql.includes("l.articulo_origen_id=r.article_id"));
 assert.equal((sql.match(/JOIN "ampedia"\.fm_ventas_lineas/g)||[]).length,1);
 assert.equal((sql.match(/JOIN "ampedia"\.fm_ventas_cabeceras/g)||[]).length,1);
});

test("almacén en la consulta de inventario y pedidos web pendientes solo con snapshot fresco",()=>{
 const stock=transferidorInventorySQL("ampedia"),web=transferidorPendingWebSQL();
 assert.match(stock,/ALMACEN/);
 assert.match(stock,/f.cliente_slug=\$1/);
 assert.match(stock,/AS "siteName"/);
 assert.match(stock,/a.kind/);
 assert.match(web,/picking_list_pendientes/);
 assert.match(web,/ultima_importacion/);
 assert.match(web,/30 minutes/);
});

test("la previsión usa solo la semana aunque las ventas del mes sean muy superiores",()=>{
 const plan=buildGlobalTransfers([
  {pharmacyId:"1",cn:"123456",stock:40,units7:0,units30:190,name:"Crema"},
  {pharmacyId:"2",cn:"123456",stock:1,units7:7,units30:120,name:"Crema"}
 ],pharmacies.slice(0,2)).transfers;
 assert.equal(plan.length,1);
 assert.equal(plan[0].units,6,"7 días de objetivo menos 1 de stock");
 assert.equal(plan[0].sales7Origin,0);
 assert.equal(plan[0].sales30Origin,190);
 assert.equal(plan[0].sales7Destination,7);
 assert.equal(plan[0].sales30Destination,120);
});

test("sin propuestas, ventas 7 y 30 se calculan igualmente en una sola lectura",async()=>{
 let salesQueries=0;
 const db={async query(arg){
  const sql=typeof arg==="string"?arg:arg.text;
  if(sql.includes("WITH chosen AS MATERIALIZED"))return {rows:[
   {cn:"123456",pharmacyId:"1",sourceCode:"ABA",articleId:"1",stock:30},
   {cn:"123456",pharmacyId:"2",sourceCode:"EUR",articleId:"2",stock:9}
  ]};
  if(sql.includes("WITH refs AS MATERIALIZED")){
   salesQueries++;
   return {rows:[{pharmacyId:"2",articleId:"2",units7:7,units30:30}]};
  }
  if(sql.includes("FROM farmetrica.picking_list_pendientes"))return {rows:[]};
  if(sql.includes("FROM farmetrica.op_pedidos"))return {rows:[]};
  if(sql.includes("FROM farmetrica.picking_list_pendientes"))return {rows:[]};
  if(sql.includes("transferidor_configuracion_cliente"))return {rows:[]};
  if(sql.includes("transferidor_exposicion_"))return {rows:[]};
  throw Error("Inesperado "+sql.slice(0,100));
 }};
 let handler;
 setupTransferidor({get(_path,...stack){handler=stack.at(-1)}},db,{requireTenant:()=>[]});
 const req={query:{pagina:1,tamano:50},context:{role:"superadministrador",
  client:{slug:"testnosuggestion",schema:"ampedia"},pharmacies:pharmacies.slice(0,2)}};
 const res={statusCode:200,status(code){this.statusCode=code;return this},
  json(body){this.body=body;return this}};
 const body=await awaitTransferResult(handler,req,res);
 assert.equal(body.status,"complete");
 assert.equal(body.total,0);
 assert.equal(salesQueries,1);
});

test("un timeout en lectura conjunta no inventa ventas 30d ni movimientos",async()=>{
 const db={async query(arg){
  const sql=typeof arg==="string"?arg:arg.text;
  if(sql.includes("WITH chosen AS MATERIALIZED"))return {rows:[
   {cn:"123456",pharmacyId:"1",sourceCode:"ABA",articleId:"11",stock:30},
   {cn:"123456",pharmacyId:"2",sourceCode:"EUR",articleId:"22",stock:0}
  ]};
  if(sql.includes("WITH refs AS MATERIALIZED"))
   throw Object.assign(Error("timeout"),{code:"57014"});
  if(sql.includes("FROM farmetrica.picking_list_pendientes"))return {rows:[]};
  if(sql.includes("FROM farmetrica.op_pedidos"))return {rows:[]};
  if(sql.includes("FROM farmetrica.picking_list_pendientes"))return {rows:[]};
  if(sql.includes("transferidor_configuracion_cliente"))return {rows:[]};
  if(sql.includes("transferidor_exposicion_"))return {rows:[]};
  throw Error("Inesperado "+sql.slice(0,100));
 }};
 let handler;
 setupTransferidor({get(_path,...stack){handler=stack.at(-1)}},db,{requireTenant:()=>[]});
 const req={query:{pagina:1,tamano:50},context:{role:"superadministrador",
  client:{slug:"testmonthlytimeout",schema:"ampedia"},pharmacies:pharmacies.slice(0,2)}};
 const res={statusCode:200,status(code){this.statusCode=code;return this},
  json(body){this.body=body;return this}};
 const body=await awaitTransferResult(handler,req,res);
 assert.equal(res.statusCode,503);
 assert.equal(body.status,"error");
 assert.equal(body.rows,undefined);
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
   return {rows:[{pharmacyId:"2",articleId:"123456",units7:7,units30:24}]};
  if(sql.includes("FROM farmetrica.picking_list_pendientes"))return {rows:[]};
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
 assert.equal(body.rows[0].sales30Destination,24);
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
    .map(r=>({pharmacyId:"2",articleId:r.article_id,units7:7,units30:30}))};
  }
  if(sql.includes("FROM farmetrica.picking_list_pendientes"))return {rows:[]};
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
  assert.equal(res.body.progress.total,3);
  assert.equal(res.body.total,175);
 }finally{unblock()}
 const body=await awaitTransferResult(handler,req,res);
 assert.equal(body.status,"complete");
 assert.equal(body.total,351);
 assert.equal(salesCount,3);
 assert.equal(body.rows[0].sales30Destination,30);
});
