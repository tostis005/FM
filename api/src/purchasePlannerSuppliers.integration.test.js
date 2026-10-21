import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {readPlannerLaboratories} from "./purchasePlannerSuppliers.js";

test("PostgreSQL: recomienda proveedor no cooperativo con PUC real y devuelve laboratorios del CN",{
 skip:!process.env.TEST_DB_URL
},async()=>{
 const pool=new pg.Pool({connectionString:process.env.TEST_DB_URL});
 try{
  const data=await readPlannerLaboratories(pool,
   {client:{slug:"ampedia",schema:"ampedia"}},[1],
   [{groupKey:"DCPF:123456789",pharmacyId:"1",articleId:"ART-01",cn:"654321"},
    {groupKey:"DCPF:123456789",pharmacyId:"1",articleId:"ART-02",cn:"654322"}],
   ["123456789"],"2026-10-21");
  const suggestion=data.recommendations.find(r=>r.groupKey==="DCPF:123456789")?.recommended;
  assert.ok(suggestion,"Las recepciones con 3 compras deben servir PUC para seleccionar laboratorio");
  assert.ok(Number.isFinite(suggestion.puc)&&suggestion.puc>0);
  assert.equal(suggestion.articleId,"ART-02");
  assert.equal(suggestion.supplierCode,"PR2");
  assert.equal(suggestion.supplierName,"Mayorista 2");
  assert.ok(data.presentations.some(r=>r.cn==="654322"));
  assert.equal(data.byPharmacy[0].options.length,2);
  // La lista visible solo contiene ART-01 (CN 654321), pero el mejor
  // PUC pertenece a ART-02 (CN 654322), otro CN del mismo DCPF.
  const narrow=await readPlannerLaboratories(pool,
   {client:{slug:"ampedia",schema:"ampedia"}},[1],
   [{groupKey:"DCPF:123456789",pharmacyId:"1",articleId:"ART-01",cn:"654321"}],
   ["123456789"],"2026-10-21");
  const cross=narrow.recommendations.find(r=>r.groupKey==="DCPF:123456789")?.recommended;
  assert.ok(cross,"El PUC de otro CN del DCPF debe estar disponible sin depender de la página");
  assert.equal(cross.cn,"654322");
  assert.equal(cross.supplierName,"Mayorista 2");
 }finally{await pool.end()}
});
