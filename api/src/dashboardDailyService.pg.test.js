import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {createDashboardConsolidationService} from "./dashboardConsolidationService.js";

test("la suma del consolidado diario coincide con vistas documentales por mes y farmacia",{
 skip:!process.env.TEST_DB_URL
},async()=>{
 const pool=new pg.Pool({connectionString:process.env.TEST_DB_URL,max:2});
 const service=createDashboardConsolidationService(pool,{
  now:()=>new Date("2026-11-15T12:00:00Z")});
 const farms=[{id:1,code:"ABA"},{id:2,code:"EUR"}];
 try{
  const args={slug:"ampedia",schema:"ampedia",farms,month:"2026-10-01"};
  assert.equal(await service.refreshDays(args,true),true);
  const {rows}=await pool.query(
   "SELECT farmacia_id,fuente,count(*)::int AS days,sum(importe)::numeric AS amount"+
   " FROM farmetrica.dashboard_consolidados_diarios"+
   " WHERE cliente_slug='ampedia' AND dia>='2026-10-01' AND dia<'2026-11-01'"+
   " GROUP BY farmacia_id,fuente ORDER BY farmacia_id,fuente");
  assert.equal(rows.length,4);
  assert.ok(rows.every(r=>r.days===31));
  for(const farm of farms)for(const [source,view] of [
   ["ventas","fm_ventas_analitica"],["compras","fm_recepciones_analitica"]]){
   const {rows:original}=await pool.query(
    "SELECT coalesce(sum(importe),0)::numeric AS amount FROM ampedia."+view+
    " WHERE farmacia_codigo=$1 AND fecha>='2026-10-01' AND fecha<'2026-11-01'",[farm.code]);
   const cached=rows.find(r=>r.farmacia_id===farm.id&&r.fuente===source);
   assert.equal(Number(cached.amount),Number(original[0].amount));
  }
  const response=await service.read({slug:"ampedia",schema:"ampedia",
   farms,ids:[1,2],from:"2026-10-01",to:"2026-10-31",granularity:"day"});
  assert.equal(response.available,true);
  assert.equal(response.cachedDays,31);
  assert.equal(response.liveToday,false);
  assert.equal(response.sales.monthly.length,1);
  assert.equal(response.purchases.monthly.length,1);
  const only=await service.read({slug:"ampedia",schema:"ampedia",
   farms:[farms[0]],ids:[1],from:"2026-10-01",to:"2026-10-31",granularity:"day"});
  assert.equal(only.available,true);
  assert.equal(only.sales.kpis.ventas,Math.round(Number(rows.find(
   r=>r.farmacia_id===1&&r.fuente==="ventas").amount)*100)/100);
 }finally{await pool.end()}
});
