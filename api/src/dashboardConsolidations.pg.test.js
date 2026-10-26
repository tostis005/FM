import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {createDashboardConsolidationService} from "./dashboardConsolidationService.js";

test("consolidados replican las vistas documentales reales en PostgreSQL",{
 skip:!process.env.TEST_DB_URL
},async()=>{
 const pool=new pg.Pool({connectionString:process.env.TEST_DB_URL,max:2});
 const service=createDashboardConsolidationService(pool,{
  now:()=>new Date("2026-11-15T12:00:00Z")});
 const farms=[{id:1,code:"ABA"},{id:2,code:"EUR"}];
 try{
  const params={slug:"ampedia",schema:"ampedia",farms,month:"2026-10-01"};
  assert.equal(await service.refreshMonth(params,true),true);
  const {rows:stored}=await pool.query(
   "SELECT * FROM farmetrica.dashboard_consolidados_mensuales"+
   " WHERE cliente_slug='ampedia' AND mes='2026-10-01' ORDER BY farmacia_id,fuente");
  assert.equal(stored.length,4);
  for(const f of farms){
   const sale=stored.find(x=>x.farmacia_id===f.id&&x.fuente==="ventas");
   const buy=stored.find(x=>x.farmacia_id===f.id&&x.fuente==="compras");
   const {rows:s}=await pool.query(
    "SELECT coalesce(sum(importe),0)::numeric AS amount,"+
    " coalesce(sum(unidades) FILTER(WHERE articulo_id IS NOT NULL),0)::numeric AS units"+
    " FROM ampedia.fm_ventas_analitica WHERE farmacia_codigo=$1"+
    " AND fecha>='2026-10-01' AND fecha<'2026-11-01'",[f.code]);
   const {rows:b}=await pool.query(
    "SELECT coalesce(sum(importe),0)::numeric AS amount"+
    " FROM ampedia.fm_recepciones_analitica WHERE farmacia_codigo=$1"+
    " AND fecha>='2026-10-01' AND fecha<'2026-11-01'",[f.code]);
   assert.equal(Number(sale.importe),Number(s[0].amount));
   assert.equal(Number(sale.unidades),Number(s[0].units));
   assert.equal(Number(buy.importe),Number(b[0].amount));
  }
  const result=await service.read({slug:"ampedia",schema:"ampedia",ids:[1,2],
   farms,from:"2026-10-01",to:"2026-10-31"});
  assert.equal(result.available,true);
  assert.equal(result.cachedMonths,1);
  assert.equal(result.liveCurrentMonth,false);
  assert.equal(result.sales.monthly.length,1);
  assert.equal(result.purchases.monthly.length,1);
  assert.equal(result.sales.kpis.ventas,
   Math.round(stored.filter(x=>x.fuente==="ventas").reduce((n,x)=>n+Number(x.importe),0)*100)/100);
  const onlyOne=await service.read({slug:"ampedia",schema:"ampedia",ids:[1],
   farms:[farms[0]],from:"2026-10-01",to:"2026-10-31"});
  assert.equal(onlyOne.available,true);
  assert.equal(onlyOne.sales.kpis.ventas,Math.round(Number(stored.find(x=>x.farmacia_id===1&&x.fuente==="ventas").importe)*100)/100);
 }finally{await pool.end()}
});
