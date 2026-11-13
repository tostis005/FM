import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {buildProactiveStockSQL,proactiveCoverageSQL} from "./proactiveStock.js";

test("PostgreSQL: alertas y stock sin ventas usan vistas reales sin escribir datos",{
 skip:!process.env.TEST_DB_URL
},async()=>{
 const pool=new pg.Pool({connectionString:process.env.TEST_DB_URL});
 try{
  const coverage=await pool.query(proactiveCoverageSQL("ampedia"),["ampedia",[1,2]]);
  assert.ok(Array.isArray(coverage.rows));
  for(const mode of ["alertas","inmovilizado"]){
   const result=await pool.query({
    text:buildProactiveStockSQL("ampedia",mode),
    values:["ampedia",[1,2],90,"",25,0],query_timeout:20000
   });
   assert.ok(Array.isArray(result.rows));
   if(result.rows.length){
    assert.ok(result.rows[0].stock>0);
    assert.equal(typeof result.rows[0].pharmacyId,"string");
    assert.ok("capital" in result.rows[0]);
   }
  }
 }finally{await pool.end();}
});