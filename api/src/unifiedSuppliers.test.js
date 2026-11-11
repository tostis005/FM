import {test} from "node:test";
import assert from "node:assert/strict";
import {listUnifiedSuppliers,readUnifiedSupplierCN,readSupplierMasterCatalogue,mergeSupplierCatalogReferences,setupUnifiedSuppliers} from "./unifiedSuppliers.js";
// Comprobar que el modo clásico sigue intacto y puede restaurarse de inmediato.
process.env.FM_PREPARADOR_ULTIMA_RECEPCION="0";
const ctx={client:{slug:"ampedia",schema:"ampedia"}};
test("el preparador excluye cooperativas e internos por clasificación, no por nomenclátor",async()=>{
 const queries=[];
 const pool={query:async q=>{queries.push(q);return {rows:[{key:"P:10",name:"Laboratorio",class:"DIRECTO"}]}}};
 const result=await listUnifiedSuppliers(pool,ctx,[1,2],true);
 assert.equal(result[0].key,"P:10");
 assert.match(queries[0].text,/p\.clase IN \(\x27DIRECTO\x27,\x27VACUNAS\x27,\x27FÓRMULAS\x27\)/);
 assert.doesNotMatch(queries[0].text,/p\.clase NOT IN/);
 assert.doesNotMatch(queries[0].text,/nomenclator/i);
 assert.deepEqual(queries[0].values,["ampedia",[1,2]]);
});
test("el CN elegible tiene recepción del proveedor exacto y farmacia seleccionada",async()=>{
 const queries=[];
 const pool={query:async q=>{
  queries.push(q);
  if(typeof q==="string"&&q.includes("preparador_exclusiones"))
   return {rows:[{cadena:"*BAJA*"}]};
  return {rows:[{referencia:"700001",cn:"700001",
   nombre:"Artículo A",tipo:"medicacion"}]};
 }};
 const result=await readUnifiedSupplierCN(pool,ctx,{
  key:"P:88",pharmacies:[1],type:"medicacion"});
 assert.equal(result.total,1);
 assert.equal(queries[1].values[2],"88");
 assert.deepEqual(queries[1].values[5],["*BAJA*"]);
 assert.match(queries[1].text,/JOIN "ampedia"\.fm_recepciones_cabeceras h/);
 assert.match(queries[1].text,/JOIN "ampedia"\.fm_recepciones_lineas l/);
 assert.match(queries[1].text,/proveedores_unificados_alias/);
 assert.match(queries[1].text,/l\.cantidad>0 AND l\.devuelta IS NOT TRUE/);
 assert.match(queries[1].text,/normalizeCode|h\.proveedor_origen_id/);
 assert.match(queries[1].text,/position\(upper\(exclude.cadena\)/);
 assert.doesNotMatch(queries[1].text,/nomenclator/i);
});
test("no acepta identificadores arbitrarios ni tipos de datos ilegales",async()=>{
 const pool={query:async()=>{throw Error("No debe consultar")}};
 await assert.rejects(()=>readUnifiedSupplierCN(pool,ctx,{
  key:"N:OTRO",pharmacies:[1],type:"medicacion"}));
 await assert.rejects(()=>readUnifiedSupplierCN(pool,ctx,{
  key:"P:2;DELETE",pharmacies:[1],type:"medicacion"}));
});

test("no es posible fusionar cooperativas ni proveedores internos desde la API",async()=>{
 const handlers={},statements=[];
 const app={get:(path,...h)=>{handlers["GET "+path]=h.at(-1)},
  post:(path,...h)=>{handlers["POST "+path]=h.at(-1)},
  put:(path,...h)=>{handlers["PUT "+path]=h.at(-1)}};
 const pool={async connect(){return {
  async query(sql){
   statements.push(sql);
   if(String(sql).includes("FOR UPDATE"))return {rows:[
    {id:"1",nombre:"Cooperativa A",clase:"MAYORISTA",activo:true},
    {id:"2",nombre:"Cooperativa B",clase:"MAYORISTA",activo:true}]};
   return {rows:[]};
  },release(){}
 }}};
 setupUnifiedSuppliers(app,pool,{requireTenant:()=>[],requireTenantAdmin:()=>[]});
 let status=200,response;
 await handlers["POST /api/tenant/proveedores-unificados/fusionar"]({
  body:{destino:"1",origenes:["2"]},context:{client:{slug:"ampedia"}}},
  {status(code){status=code;return this},json(value){response=value;return this}},
  e=>{throw e});
 assert.equal(status,400);
 assert.match(response.error,/Solo se pueden unificar laboratorios/);
 assert.ok(!statements.some(sql=>String(sql).startsWith("UPDATE farmetrica.proveedores_unificados_alias")));
});

test("el gestor puede unificar laboratorios, pero el CSV sigue siendo exclusivo del administrador",()=>{
 const routes={};
 const app={get(){},put(){},post(path,...handlers){routes[path]=handlers}};
 const managerGuard=(_req,_res,next)=>next(),adminGuard=(_req,_res,next)=>next();
 setupUnifiedSuppliers(app,{},{
  requireTenant:()=>[],requireTenantAdmin:()=>[adminGuard],
  requireTenantManager:()=>[managerGuard]
 });
 assert.equal(routes["/api/tenant/proveedores-unificados/fusionar"][0],managerGuard);
 assert.equal(routes["/api/tenant/proveedores-unificados/importar"][0],adminGuard);
});

test("el preparador devuelve productos del catálogo aunque nunca se hayan comprado",async()=>{
 const queries=[];
 const stockOnly={referencia:"000125",cn:"000125",nombre:"Crema sin ventas",
  tipo:"parafarmacia",inPurchases:false,inReceipts:false};
 const pool={async query(q){
  const sql=typeof q==="string"?q:q.text;queries.push(sql);
  if(sql.includes("FROM farmetrica.preparador_exclusiones"))return {rows:[]};
  if(sql.includes("FROM matched"))return {rows:[stockOnly]};
  return {rows:[]}; // Ninguna recepción histórica
 }};
 const catalog=await readUnifiedSupplierCN(pool,ctx,{
  key:"P:88",pharmacies:[1],type:"parafarmacia"
 });
 assert.equal(catalog.total,1);
 assert.equal(catalog.rows[0].cn,"000125");
 assert.equal(catalog.rows[0].inPurchases,false);
 assert.match(queries.find(q=>q.includes("FROM matched")),/proveedor_habitual_id/);
 assert.match(queries.find(q=>q.includes("FROM matched")),/proveedores_unificados_alias/);
});
test("no mezcla proveedores homónimos de otras farmacias ni duplica CN entre fuentes",async()=>{
 const pool={async query(q){
  const sql=typeof q==="string"?q:q.text;
  assert.match(sql,/c\\.code=upper\\(btrim\\(ua\\.farmacia_codigo\\)\\)/);
  return {rows:[]};
 }};
 await readSupplierMasterCatalogue(pool,ctx,{
  id:"88",pharmacies:[1,2],type:"parafarmacia",patterns:[]
 });
 const common={referencia:"012345",cn:"012345",nombre:"Producto",
  tipo:"parafarmacia"};
 const merged=mergeSupplierCatalogReferences(
  [{...common,inPurchases:true,inReceipts:true}],
  [{...common,inPurchases:false,inReceipts:false},
   {referencia:"ERP:1:ABC",cn:null,nombre:"Sin CN",tipo:"parafarmacia"}],
  "","parafarmacia");
 assert.equal(merged.total,2);
 assert.equal(merged.rows.find(r=>r.cn==="012345").inPurchases,true);
 assert.ok(merged.rows.some(r=>r.referencia==="ERP:1:ABC"));
});
