import test from "node:test";
import assert from "node:assert/strict";
import {normalizeLaboratoryKey,selectedPharmacies,readLaboratoryArticles} from "./laboratoryCatalog.js";

test("solo acepta referencias de laboratorio válidas sin crear claves arbitrarias",()=>{
 assert.equal(normalizeLaboratoryKey(" c:lab-17 "), "C:LAB-17");
 assert.equal(normalizeLaboratoryKey("n:Laboratorios Ejemplo"),"N:LABORATORIOS EJEMPLO");
 assert.equal(normalizeLaboratoryKey("LABORATORIO"),null);
 assert.equal(normalizeLaboratoryKey("C:"),null);
 assert.equal(normalizeLaboratoryKey("C:ok\nmal"),null);
});
test("la selección no puede incluir farmacias de otro cliente",()=>{
 const context={pharmacies:[{id:"1"},{id:"4"}]};
 assert.deepEqual(selectedPharmacies(context,""),[1,4]);
 assert.deepEqual(selectedPharmacies(context,"4,4"),[4]);
 assert.equal(selectedPharmacies(context,"1,2"),null);
 assert.equal(selectedPharmacies(context,"0"),null);
});
test("las consultas de catálogo aíslan tenant, farmacia y usan el CN ERP documentado",async()=>{
 let captured;
 const pool={query:async q=>{captured=q;return {rows:[{referencia:"ERP:4:1234567",
  nombre:"Artículo sin CN",cn:null,tipo:"parafarmacia",inMaster:false,
  inReceipts:true,provisional:true,total:1}]}}};
 const context={client:{slug:"cliente",schema:"cliente"},pharmacies:[{id:"4"}]};
 const found=await readLaboratoryArticles(pool,context,{
  key:"C:LAB",pharmacies:[4],type:"parafarmacia",search:"art",page:2,size:50
 });
 assert.equal(found.total,1);
 assert.equal(found.rows[0].cn,null);
 assert.deepEqual(captured.values,["C:LAB",[4],"cliente","parafarmacia","art",50,50]);
 assert.match(captured.text,/m\.cliente_slug=\$3/);
 assert.match(captured.text,/m\.farmacia_id=f\.id/);
 assert.match(captured.text,/med\.cn=nullif\(btrim\(a\.codigo_nacional\)/);
 assert.doesNotMatch(captured.text,/r\.articulo_id::text ~/);
 assert.match(captured.text,/LIMIT \$6 OFFSET \$7/);
});
