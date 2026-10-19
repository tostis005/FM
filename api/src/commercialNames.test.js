import test from "node:test";
import assert from "node:assert/strict";
import {loadCommercialNames,nameCommercialRows} from "./commercialNames.js";

const context={client:{slug:"test_tenant",schema:"test_tenant"},
 allowedPharmacyIds:[1,2],pharmacies:[{id:1,sourceCode:"F1"},{id:2,sourceCode:"F2"}]};
function fakePool({missingVendors=false,missingSuppliers=false}={}){
 const calls=[];
 const pool={async query(sql,params){
  calls.push({sql,params});
  if(sql.includes("information_schema.columns")){
   const tables=[...(missingSuppliers?[]:["proveedores"]),...(missingVendors?[]:["vendedores"])];
   return {rows:tables.flatMap(table_name=>["farmacia_codigo","origen_id","nombre","sincronizado_en"].map(column_name=>({table_name,column_name})))};
  }
  if(sql.includes('."proveedores" m')){
   assert.ok(params[1].length>=1&&params[1].every(id=>[1,2].includes(id)));
   return {rows:[{pharmacyId:"1",code:"12",name:"Cooperativa Centro"},
    {pharmacyId:"2",code:"12",name:"Mayorista Norte"}]};
  }
  if(sql.includes('."vendedores" m')){
   return {rows:[{pharmacyId:"1",code:"3",name:"Marga Abadía"},
    {pharmacyId:"2",code:"3",name:"Clara Abadía"}]};
  }
  if(sql.includes("farmetrica.proveedores_maestro")){
   assert.equal(params[0],"test_tenant");
   return {rows:[{code:"99",name:"Proveedor manual"}]};
  }
  throw Error("SQL no esperado: "+sql);
 }};
 return {pool,calls};
}
test("proveedor y vendedor del mismo ID son distintos en cada farmacia",async()=>{
 const {pool,calls}=fakePool();
 const names=await loadCommercialNames(pool,context,[
  {pharmacyId:1,supplierCode:" 12 ",sellerId:"3"},
  {pharmacyId:2,supplierCode:"12",sellerId:"3"},
  {pharmacyId:99,supplierCode:"12",sellerId:"3"},
  {pharmacyId:1,supplierCode:"99"}
 ]);
 assert.equal(names.supplier(1,"12"),"Cooperativa Centro");
 assert.equal(names.supplier(2,"12"),"Mayorista Norte");
 assert.equal(names.supplier(1,"99"),"Proveedor manual");
 assert.equal(names.seller(1,"3"),"Marga Abadía");
 assert.equal(names.seller(2,"3"),"Clara Abadía");
 assert.equal(names.seller(2,"67"),"67");
 assert.equal(names.supplier(1,"777"),"777");
 assert.ok(calls.every(call=>!call.sql.includes("99,")));
 assert.ok(calls.filter(x=>x.sql.includes('."vendedores" m')).every(x=>x.sql.includes("cliente_slug=$1")));
});
test("sin vendedores sincronizados se conserva código y se usa maestro de proveedores",async()=>{
 const {pool,calls}=fakePool({missingVendors:true,missingSuppliers:true});
 const rows=await nameCommercialRows(pool,context,[
  {pharmacyId:"1",supplierCode:"99",sellerId:"5"},
  {pharmacyId:"2",supplierCode:"12",sellerId:"3"}
 ]);
 assert.equal(rows[0].supplierName,"Proveedor manual");
 assert.equal(rows[0].sellerName,"5");
 assert.equal(rows[1].supplierName,"12");
 assert.equal(rows[1].sellerName,"3");
 assert.ok(!calls.some(x=>x.sql.includes('."vendedores" m')));
});
test("no se accede al catálogo de una farmacia no autorizada",async()=>{
 const {pool,calls}=fakePool();
 const n=await loadCommercialNames(pool,context,[{pharmacyId:200,supplierCode:"12",sellerId:"3"}]);
 assert.equal(n.seller(200,"3"),"3");
 assert.equal(calls.length,0,"no deben consultarse nombres de farmacias ajenas");
});
test("los nombres no modifican campos operativos",async()=>{
 const {pool}=fakePool();
 const result=await nameCommercialRows(pool,context,[{pharmacyId:"1",supplierCode:"12",sellerId:"3",units:4,amount:35}]);
 assert.deepEqual(result[0],{pharmacyId:"1",supplierCode:"12",sellerId:"3",supplierName:"Cooperativa Centro",sellerName:"Marga Abadía",units:4,amount:35});
});
