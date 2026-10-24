import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {readLaboratoryOrderMatrix} from "./laboratoryOrderPlanner.js";

test("PostgreSQL real: matriz de cinco métricas identifica CN y farmacia autorizada",{
 skip:!process.env.TEST_DB_URL
},async()=>{
 const pool=new pg.Pool({connectionString:process.env.TEST_DB_URL});
 try{
  await pool.query("UPDATE farmetrica.nomenclator_presentaciones SET laboratorio_codigo='CI-LAB-A',laboratorio='Laboratorio CI' WHERE cn='654321'");
  await pool.query("UPDATE ampedia.articulos SET stock_actual=6 WHERE farmacia_codigo='ABA' AND origen_id='ART-01'");
  const ctx={client:{slug:"ampedia",schema:"ampedia"},
   pharmacies:[{id:1,name:"Abadía"},{id:2,name:"Europa"}]};
  const data=await readLaboratoryOrderMatrix(pool,ctx,{
   key:"C:CI-LAB-A",pharmacies:[1,2],type:"medicacion",
   from:"2026-10-01",to:"2026-10-24",search:"",page:1,size:40
  });
  assert.ok(data.rows.some(r=>r.cn==="654321"),"CN del nomenclátor en el laboratorio");
  const item=data.rows.find(r=>r.cn==="654321");
  assert.ok(item.byPharmacy["1"],"La farmacia Abadía tiene su columna");
  assert.ok(item.byPharmacy["2"],"La farmacia Europa tiene su columna");
  assert.equal(item.byPharmacy["1"].stock,6);
  assert.equal(typeof item.byPharmacy["1"].unitsPeriod,"number");
  assert.equal(typeof item.byPharmacy["1"].units3,"number");
  assert.equal(typeof item.byPharmacy["1"].units12,"number");
  assert.equal(typeof item.byPharmacy["1"].suggested,"number");
 }finally{await pool.end();}
});
