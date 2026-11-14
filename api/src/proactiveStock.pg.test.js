import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {proactiveInventorySQL,proactiveSalesSliceSQL,proactiveCoverageSQL,
 proactiveLastSaleSQL,classifyProactiveStock} from "./proactiveStock.js";

test("PostgreSQL: inventario y ventas troceadas consultan documentos reales, sin escrituras",{
 skip:!process.env.TEST_DB_URL
},async()=>{
 const pool=new pg.Pool({connectionString:process.env.TEST_DB_URL});
 try{
  const coverage=await pool.query(proactiveCoverageSQL("ampedia"),["ampedia",[1,2]]);
  assert.ok(Array.isArray(coverage.rows));
  const inventory=await pool.query({text:proactiveInventorySQL("ampedia"),
   values:["ampedia",1,""],query_timeout:20000});
  assert.ok(Array.isArray(inventory.rows));
  const sales=await pool.query({text:proactiveSalesSliceSQL("ampedia"),
   values:["ABA","2026-10-01","2026-10-15","2026-10-08"],query_timeout:20000});
  assert.ok(Array.isArray(sales.rows));
  for(const row of sales.rows){
   assert.equal(typeof row.articleId,"string");
   assert.ok(Number.isFinite(Number(row.units)));
  }
  const history=await pool.query({text:proactiveLastSaleSQL("ampedia"),
   values:["ABA",["A-00001","R1","R2"],"2026-10-01"],query_timeout:20000});
  assert.ok(Array.isArray(history.rows));
  for(const row of history.rows){
   assert.equal(typeof row.articleId,"string");
   assert.ok(row.lastSaleDate!=null);
  }
  for(const row of inventory.rows.slice(0,5)){
   const signal=classifyProactiveStock(row,null,90);
   assert.equal(signal.unitsPeriod,0);
   assert.ok(["sin_ventas"].includes(signal.alertType));
  }
 }finally{await pool.end();}
});