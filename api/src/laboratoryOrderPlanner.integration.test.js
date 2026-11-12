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

test("PostgreSQL real: farmacia sin ficha de CN muestra 0, ficha con stock nulo conserva desconocido",{
 skip:!process.env.TEST_DB_URL
},async()=>{
 const pool=new pg.Pool({connectionString:process.env.TEST_DB_URL});
 try{
  // Fixture: ABA tiene el CN 654322; EUR tiene inventario cargado, pero
  // NO dispone de ese CN. No inferir compras ni ventas que no se conocen.
  await pool.query("UPDATE ampedia.articulos SET stock_actual=NULL WHERE farmacia_codigo='ABA' AND origen_id='ART-02'");
  const ctx={client:{slug:"ampedia",schema:"ampedia"},
   pharmacies:[{id:1,name:"Abadía"},{id:2,name:"Europa"}]};
  const data=await readLaboratoryOrderMatrix(pool,ctx,{
   key:"C:CI-LAB-A",pharmacies:[1,2],type:"medicacion",
   from:"2026-10-01",to:"2026-10-24",
   prefetchedRows:[{referencia:"654322",cn:"654322",nombre:"Omeprazol B"}]
  });
  assert.equal(data.metricsUnavailable,false);
  const item=data.rows[0];
  assert.equal(item.byPharmacy["2"].stock,0,"Sin ficha ERP, pero inventario de EUR cargado");
  assert.equal(item.byPharmacy["2"].stockInferredZero,true);
  assert.equal(item.byPharmacy["2"].suggested,0,"Sin ventas del CN, no propone comprar");
  assert.equal(item.byPharmacy["1"].stock,null,"Ficha ERP existente con dato nulo no se inventa");
  assert.equal(item.byPharmacy["1"].stockInferredZero,false);
  assert.equal(item.byPharmacy["1"].suggested,null,"Propuesta insegura sigue no disponible");
 }finally{await pool.end();}
});
