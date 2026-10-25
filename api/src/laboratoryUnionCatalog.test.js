import test from "node:test";
import assert from "node:assert/strict";
import {unionLaboratoryReferences,readUnifiedLaboratoryCatalog} from "./laboratoryUnionCatalog.js";

test("UNION de CN: Nomenclátor + dos proveedores equivalentes sin duplicar códigos",()=>{
 const official=[
  {referencia:"400123",cn:"400123",nombre:"Producto oficial",tipo:"medicacion",
   inMaster:true,inPurchases:false,inSales:false},
  {referencia:"400124",cn:"400124",nombre:"Segundo medicamento",tipo:"medicacion",inMaster:true}
 ];
 const purchased=[
  {referencia:"400123",cn:"400123",nombre:"Producto proveedor 1",tipo:"medicacion",
   inMaster:false,inPurchases:true,pharmacyIds:"1"},
  {referencia:"400123",cn:"400123",nombre:"Producto proveedor 2",tipo:"medicacion",
   inMaster:false,inPurchases:true,pharmacyIds:"2"},
  {referencia:"400125",cn:"400125",nombre:"Tercer medicamento comprado",tipo:"medicacion",
   inPurchases:true,pharmacyIds:"2"}
 ];
 const all=unionLaboratoryReferences(official,purchased,"","medicacion");
 assert.deepEqual(all.map(r=>r.cn),["400123","400124","400125"]);
 assert.equal(all[0].nombre,"Producto oficial");
 assert.equal(all[0].inMaster,true);
 assert.equal(all[0].inPurchases,true);
 assert.equal(all[0].pharmacyIds,"1,2");
 assert.deepEqual(unionLaboratoryReferences(official,purchased,"tercer","medicacion")
  .map(r=>r.cn),["400125"]);
});
test("UNION conserva referencias ERP de parafarmacia sin CN, aisladas por farmacia",()=>{
 const rows=unionLaboratoryReferences([],[
  {referencia:"ERP:1:AB1",cn:null,nombre:"Producto local",tipo:"parafarmacia"},
  {referencia:"ERP:2:AB1",cn:null,nombre:"Producto local",tipo:"parafarmacia"},
  {referencia:"000224",cn:"000224",nombre:"Crema",tipo:"parafarmacia"}
 ],"","parafarmacia");
 assert.equal(rows.length,3);
 assert.equal(rows.filter(r=>!r.cn).length,2);
});
test("la consulta unificada hace una lectura oficial y una por proveedor, sin consultar ventas",async()=>{
 const queries=[],ctx={client:{slug:"ampedia",schema:"ampedia"},pharmacies:[{id:1}]};
 const pool={async query(q){
  const sql=typeof q==="string"?q:q.text;queries.push({sql,values:q.values});
  if(sql.includes("information_schema.columns"))return {rows:[{available:true}]};
  if(sql.includes("FROM farmetrica.preparador_exclusiones"))return {rows:[]};
  if(sql.includes("WITH p AS ("))return {rows:[{
   referencia:"400567",cn:"400567",nombre:"Medicamento AEMPS",tipo:"medicacion",
   inMaster:true,inPurchases:false,total:1
  }]};
  if(sql.includes("links AS MATERIALIZED"))return {rows:[{
   referencia:"400567",cn:"400567",nombre:"Medicamento comprado",tipo:"medicacion",
   inMaster:false,inPurchases:true,total:1
  }]};
  throw Error("Consulta SQL adicional no contemplada");
 }};
 const result=await readUnifiedLaboratoryCatalog(pool,ctx,{
  key:"N:CINFA",pharmacies:[1],type:"medicacion"
 });
 assert.equal(result.total,1);
 assert.equal(result.rows[0].inPurchases,true);
 assert.ok(queries.some(q=>q.sql.includes("FROM activity WHERE tipo=$8")));
 assert.ok(queries.some(q=>q.values?.at(-1)==="medicacion"));
 assert.ok(!queries.some(q=>q.sql.includes("WITH refs AS MATERIALIZED")));
});
