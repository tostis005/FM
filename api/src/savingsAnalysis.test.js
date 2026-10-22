import test from "node:test";
import assert from "node:assert/strict";
import {economicScope,readOnly,combineEconomicRows,economicOverview,economicPrices,economicStock,setupSavingsAnalysis} from "./savingsAnalysis.js";
function req(query={},role="administrador",mods={ventas:true,compras:true,stock:true}){
 return {query:{desde:"2025-10-22",hasta:"2026-10-21",farmacias:"1",...query},
  context:{client:{slug:"ampedia",schema:"ampedia"},role,modules:mods,allowedPharmacyIds:[1,2],
   pharmacies:[{id:"1",name:"ABA"},{id:"2",name:"EUR"}]}};
}
test("rechaza ámbitos cruzados, períodos desmedidos y roles sin permiso",()=>{
 const valid=economicScope(req());
 assert.deepEqual(valid.ids,[1]);
 assert.equal(valid.schema,'"ampedia"');
 assert.throws(()=>economicScope(req({farmacias:"3"})),{status:403});
 assert.throws(()=>economicScope(req({farmacias:"1); DROP TABLE ventas"})),{status:403});
 assert.throws(()=>economicScope(req({desde:"2024-01-01"})),{status:400});
 assert.throws(()=>economicScope(req({}, "farmacia")),{status:403});
 assert.throws(()=>economicScope(req({}, "administrador",{ventas:true,compras:true,stock:false})),{status:403});
 assert.throws(()=>economicScope({...req(),context:{...req().context,client:{slug:"ampedia",schema:'ampedia";drop'}}}),{status:400});
});
test("los importes incompletos no se presentan como totales",()=>{
 const r=combineEconomicRows(
  [{lines:2,withAmount:1,amount:500,units:3}],
  [{lines:1,withAmount:0,amount:0,units:4,channel:"sin_verificar"}],
  [{lines:2,priced:1,amount:30,updated:"2026-10-21"}]);
 assert.equal(r.sales.amount,null);
 assert.equal(r.purchases.amount,null);
 assert.equal(r.purchases.channels.sin_verificar.amount,null);
 assert.equal(r.stock.amount,null);
 assert.equal(r.stock.valuedSubtotal,30);
});
test("consulta sólo SELECT en transacción read-only y aplica filtros por tenant/farmacia",async()=>{
 const seen=[];
 const db={async query(sql,params){
  seen.push({sql,params});
  if(sql==="BEGIN TRANSACTION READ ONLY"||sql==="ROLLBACK"||sql.startsWith("SET LOCAL "))return {rows:[]};
  if(sql.startsWith("SELECT f.id::text AS")&&sql.includes("fm_ventas_analitica"))
   return {rows:[{pharmacyId:"1",pharmacy:"ABA",lines:2,withAmount:2,amount:100,units:3}]};
  if(sql.startsWith("SELECT f.id::text AS")&&sql.includes("fm_recepciones_analitica"))
   return {rows:[{pharmacyId:"1",channel:"cooperativa",lines:1,withAmount:1,amount:20,units:5}]};
  if(sql.startsWith("SELECT f.id::text AS")&&sql.includes(".articulos a"))
   return {rows:[{pharmacyId:"1",lines:3,priced:3,amount:10,updated:"2026-10-21"}]};
  if(sql.includes("WITH grouped"))return {rows:[{totals:{references:1,verified:1,observed:40,indicative:40},
   rows:[{fid:"1",article:"123",diff_eur:40}]}]};
  if(sql.includes("WITH sold"))return {rows:[{pharmacyId:"1",withoutSalesValue:55,excessCapital:10}]};
  throw Error("unexpected sql "+sql.slice(0,100));
 }};
 const pool={async connect(){return {...db,release(){seen.push({sql:"RELEASE"})}}}};
 const scope=economicScope(req());
 const ov=await readOnly(pool,client=>economicOverview(client,scope));
 assert.equal(ov.totals.sales.amount,100);
 assert.equal(ov.totals.purchases.channels.cooperativa.amount,20);
 const prices=await readOnly(pool,client=>economicPrices(client,scope,25));
 assert.equal(prices.totals.observed,40);
 const stock=await readOnly(pool,client=>economicStock(client,scope));
 assert.equal(stock.rows[0].withoutSalesValue,55);
 assert.equal(seen.filter(q=>q.sql==="BEGIN TRANSACTION READ ONLY").length,3);
 assert.equal(seen.filter(q=>q.sql==="ROLLBACK").length,3);
 assert.ok(seen.some(q=>q.sql.includes("HAVING count(DISTINCT channel)=2")));
 assert.ok(seen.some(q=>q.sql.includes("pm.ignorar_informes")));
 assert.ok(seen.some(q=>q.sql.includes("farmetrica.op_politicas_reposicion")));
 assert.ok(seen.filter(q=>q.params&&q.params.length===4).every(q=>q.params[3]==="ampedia"));
});
test("el endpoint requiere sesión de tenant y nunca ejecuta SQL desde el usuario",async()=>{
 const routes={};
 const app={get(path,...handlers){routes[path]=handlers}};
 setupSavingsAnalysis(app,{connect:async()=>{throw Error("No debería consultar DB")}},
  {requireTenant:()=>[(req,res,next)=>res.status(401).json({error:"Autenticación requerida"})]});
 assert.deepEqual(Object.keys(routes).sort(),[
  "/api/analytics/ahorro/precios","/api/analytics/ahorro/resumen","/api/analytics/ahorro/stock"]);
 assert.equal(routes["/api/analytics/ahorro/resumen"].length,2);
});
