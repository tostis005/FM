import {test} from "node:test";
import assert from "node:assert/strict";
import {includedPurchaseSupplier,sourceSupplierRows,purchaseSupplierChannelSQL} from "./supplierReporting.js";
test("exclusión por código y nombre, vinculada al cliente SQL",()=>{
 const text=includedPurchaseSupplier({tenant:"$6",code:"t.proveedor_id",name:"t.proveedor_nombre"});
 assert.match(text,/pm.cliente_slug=\$6/);
 assert.match(text,/pm.codigo_origen/);
 assert.match(text,/pm.nombre/);
 assert.match(text,/pm.ignorar_informes=true/);
});
test("rechaza expresiones SQL externas",()=>{
 assert.throws(()=>includedPurchaseSupplier({tenant:"$1",code:"t.id);DROP TABLE x;--"}));
});
test("los proveedores sincronizados reciben indicadores guardables y overrides",()=>{
 const rows=sourceSupplierRows([{id:"9",sourceCode:"AAA",name:"Mi proveedor",type:"mayorista",cooperative:true,ignoreReports:true}],
 [{sourceCode:"aaa",name:"Nombre ERP"},{sourceCode:"BBB",name:"Externo"}]);
 assert.equal(rows.length,2);
 const a=rows.find(x=>x.sourceCode==="AAA"),b=rows.find(x=>x.sourceCode==="BBB");
 assert.equal(a.ignoreReports,true);assert.equal(a.cooperative,true);assert.equal(a.name,"Mi proveedor");
 assert.equal(b.id,null);assert.equal(b.ignoreReports,false);
});

test("Dashboard clasifica compras exclusivamente por el check de cooperativa",()=>{
 const sql=purchaseSupplierChannelSQL("pm");
 assert.equal(sql,"CASE WHEN pm.cooperativa IS TRUE THEN 'cooperativa' ELSE 'laboratorio' END");
 assert.doesNotMatch(sql,/\.tipo|sin_clasificar|mayorista/);
 assert.throws(()=>purchaseSupplierChannelSQL("pm; DROP TABLE proveedores"),/Alias SQL/);
});
