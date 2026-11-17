import test from "node:test";
import assert from "node:assert/strict";
import {stockMatrixFilters,buildStockMatrixSQL} from "./stockMatrix.js";
const context={client:{slug:"demo",schema:"demo"},allowedPharmacyIds:[1,2],
 pharmacies:[{id:1,name:"A"},{id:2,name:"B"}],warehouses:[{id:9,name:"Almacén",active:true}]};
test("matriz usa las farmacias autorizadas y valida la selección",()=>{
 assert.deepEqual(stockMatrixFilters({context,query:{}}).ids,[1,2]);
 assert.deepEqual(stockMatrixFilters({context,query:{farmacias:"2"}}).ids,[2]);
 assert.throws(()=>stockMatrixFilters({context,query:{farmacias:"3"}}),{status:403});
 assert.throws(()=>stockMatrixFilters({context,query:{farmacias:"2;DROP"}}),{status:400});
 assert.deepEqual(stockMatrixFilters({context,query:{tipo:"almacenes"}}).ids,[9]);
 assert.throws(()=>stockMatrixFilters({context,query:{tipo:"almacenes",farmacias:"1"}}),{status:403});
});
test("SQL agrega por CN y mantiene separados los códigos ERP locales",()=>{
 const sql=buildStockMatrixSQL("demo");
 assert.match(sql,/THEN 'CN:'\|\|btrim\(a.codigo_nacional\)/);
 assert.match(sql,/ELSE 'ERP:'\|\|f.id::text/);
 assert.match(sql,/jsonb_object_agg/);
 assert.match(sql,/count\(\*\) OVER\(\)/);
 assert.throws(()=>buildStockMatrixSQL("demo;drop"));
 assert.throws(()=>buildStockMatrixSQL("demo","unsafe"));
});
test("filtros y ordenación se validan",()=>{
 assert.equal(stockMatrixFilters({context,query:{soloConStock:"false"}}).soloConStock,false);
 assert.throws(()=>stockMatrixFilters({context,query:{tamano:"999"}}),{status:400});
 assert.match(buildStockMatrixSQL("demo","stock","desc"),/p\."stockTotal" DESC/);
});
