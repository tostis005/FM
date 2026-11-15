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

test("PostgreSQL real: sin ficha y ficha con stock NULL se contabilizan como cero",{
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
  assert.equal(item.byPharmacy["1"].stock,0,"La ficha con stock NULL cuenta como cero");
  assert.equal(item.byPharmacy["1"].stockInferredZero,true,
   "Se identifica el cero asumido sin modificar Farmatic");
  assert.equal(typeof item.byPharmacy["1"].suggested,"number",
   "La propuesta se calcula con stock cero tras obtener las ventas");
 }finally{await pool.end();}
});

test("PostgreSQL: cero y dos almacenes opcionales, stock sin duplicados",{
 skip:!process.env.TEST_DB_URL
},async()=>{
 const pool=new pg.Pool({connectionString:process.env.TEST_DB_URL,max:1});
 const db=await pool.connect();
 try{
  await db.query("BEGIN");
  const {rows:[first]}=await db.query(
   "UPDATE farmetrica.farmacias SET activo=true,tipo_establecimiento='almacen' "+
   "WHERE cliente_slug='ampedia' AND codigo_origen='ALMACEN' RETURNING id");
  assert.ok(first,"Almacén físico disponible en fixture");
  const {rows:[second]}=await db.query(
   "INSERT INTO farmetrica.farmacias(cliente_slug,nombre,ciudad,activo,codigo_origen,tipo_establecimiento) "+
   "VALUES('ampedia','CI Almacén 2','',true,'ALMCI02','almacen') RETURNING id");
  await db.query(`INSERT INTO ampedia.articulos
    (farmacia_codigo,origen_id,nombre,codigo_nacional,familia,pmc,pvp,stock_actual)
    VALUES
     ('ABA','WHCI-P','Prueba multi-almacén','000987','Test',1,3,2),
     ('ALMACEN','WHCI-W1','Prueba multi-almacén','000987','Test',1,3,3),
     ('ALMCI02','WHCI-W2','Prueba multi-almacén','000987','Test',1,3,4)`);
  const ctx={client:{slug:"ampedia",schema:"ampedia"},pharmacies:[{id:1}],
   warehouses:[
    {id:String(first.id),name:"Almacén central",active:true,establishmentType:"almacen"},
    {id:String(second.id),name:"CI Almacén 2",active:true,establishmentType:"almacen"}
   ]};
  const options={key:"P:1",pharmacies:[1],type:"parafarmacia",
   from:"2026-10-01",to:"2026-11-14",
   prefetchedRows:[{referencia:"000987",cn:"000987",nombre:"Prueba"}]};
  const data=await readLaboratoryOrderMatrix(db,ctx,options);
  assert.equal(data.metricsUnavailable,false,data.warning||"");
  assert.equal(data.warehouseConfigured,true);
  assert.equal(data.warehouses.length,2);
  const item=data.rows[0];
  assert.equal(item.pharmacyStock,2);
  assert.equal(item.warehouseStock,7);
  assert.equal(item.globalStock,9);
  assert.equal(item.warehouseBySite[String(first.id)].stock,3);
  assert.equal(item.warehouseBySite[String(second.id)].stock,4);
  const none=await readLaboratoryOrderMatrix(db,{...ctx,warehouses:[]},options);
  assert.equal(none.metricsUnavailable,false,none.warning||"");
  assert.equal(none.warehouseConfigured,false);
  assert.equal(none.rows[0].globalStock,2);
  assert.deepEqual(none.rows[0].warehouseBySite,{});
  await db.query("ROLLBACK");
 }catch(error){await db.query("ROLLBACK").catch(()=>{});throw error}
 finally{db.release();await pool.end()}
});
