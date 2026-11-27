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
  if(sql.includes("information_schema.columns"))return {rows:[{column_name:"proveedor_habitual_id"}]};
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
  if(sql.includes("information_schema.columns"))
   return {rows:[{column_name:"proveedor_habitual_id"}]};
  assert.ok(sql.includes("c.code=upper(btrim(ua.farmacia_codigo))"));
  assert.ok(sql.includes("a.proveedor_habitual_id"));
  assert.ok(!sql.includes("to_jsonb(a)->>'proveedor_habitual_id'"));
  assert.match(sql,/ua\.proveedor_id=\$3/);
  assert.match(sql,/winner\.lab_id<>original\.lab_id/);
  assert.doesNotMatch(sql,/other\.nombre|equivalent AS MATERIALIZED/);
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

test("catálogo: CN nativo evita JSON y el esquema antiguo mantiene el mismo universo",async()=>{
 for(const native of [true,false]){
  const statements=[];
  const expected=[
   {referencia:"012345",cn:"012345",nombre:"Producto con CN",tipo:"parafarmacia"},
   {referencia:"ERP:1:XYZ",cn:null,nombre:"Producto sin CN",tipo:"parafarmacia"}
  ];
  const pool={async query(query){
   const sql=typeof query==="string"?query:query.text;
   statements.push(sql);
   if(sql.includes("SELECT column_name")&&sql.includes("information_schema.columns"))
    return {rows:[{column_name:"proveedor_habitual_id"}]};
   if(sql.includes("SELECT EXISTS")&&sql.includes("information_schema.columns"))
    return {rows:[{available:native}]};
   if(sql.includes("FROM matched"))return {rows:expected};
   throw Error("Consulta inesperada: "+sql.slice(0,50));
  }};
  const rows=await readSupplierMasterCatalogue(pool,ctx,{
   id:"88",pharmacies:[1],type:"parafarmacia",patterns:[]
  });
  assert.deepEqual(rows,expected);
  const sql=statements.find(q=>q.includes("FROM matched"));
  assert.ok(sql);
  assert.match(sql,/a\.codigo_nacional/);
  assert.match(sql,/a\.origen_id::text/);
  if(native){
   assert.match(sql,/btrim\(a\.cn_normalizado\)/);
   assert.doesNotMatch(sql,/to_jsonb\(a\)/,
    "La columna física debe leerse sin convertir cada ficha a JSON");
  }else assert.match(sql,/to_jsonb\(a\)->>'cn_normalizado'/);
  assert.match(sql,/WHERE \(cn IS NOT NULL OR article_id/);
  assert.match(sql,/winner\.lab_id<>original\.lab_id/);
 }
});

test("el directorio unificado usa solo el código real del almacén",async()=>{
 const queries=[];
 const pool={query:async query=>{queries.push(query);return {rows:[]};}};
 await listUnifiedSuppliers(pool,{client:{slug:"ampedia",schema:"ampedia"}},[1,6],false);
 assert.equal(queries.length,1);
 assert.doesNotMatch(queries[0].text,/='AMP'/);
 assert.deepEqual(queries[0].values,["ampedia",[1,6]]);
});

test("un gestor puede vincular un proveedor del almacén con código ALMACEN sin afectar otras farmacias",async()=>{
 const handlers={},queries=[];
 const app={get(){},post(){},put(path,...args){handlers[path]=args.at(-1)}};
 const connection={
  async query(query,values){
   const text=typeof query==="string"?query:query.text;
   queries.push({text,values});
   if(text.includes("SELECT p.id"))return {rows:[{id:"17"}]};
   return {rows:[],rowCount:1};
  },release(){}
 };
 const pool={async connect(){return connection}};
 setupUnifiedSuppliers(app,pool,{requireTenant:()=>[],requireTenantAdmin:()=>[],
  requireTenantManager:()=>[]});
 const req={
  params:{id:"17"},body:{pharmacyCode:"ALMACEN",sourceCode:"4032",sourceName:"Abbott"},
  context:{client:{slug:"ampedia"},pharmacies:[{id:"1"}],warehouses:[{id:"6"}]}
 };
 let status=200,response,err;
 await handlers["/api/tenant/proveedores-unificados/:id/origen"](req,{
  status(n){status=n;return this},json(value){response=value}
 },e=>{err=e});
 if(err)throw err;
 assert.equal(status,200);assert.deepEqual(response,{saved:true});
 const validity=queries.find(q=>q.text.includes("SELECT p.id"));
 assert.ok(validity);
 assert.doesNotMatch(validity.text,/='AMP'/);
 assert.equal(validity.values[2],"ALMACEN");
 assert.deepEqual(validity.values[3],[1,6]);
 assert.ok(queries.some(q=>q.text.includes("INSERT INTO farmetrica.proveedores_unificados_alias")));
});

test("la auditoría expone fusiones del almacén y candidatos con destinos explícitos",async()=>{
 const routes={};
 const app={get(path,...handlers){routes[path]=handlers.at(-1)},post(){},put(){}};
 const pool={async query(q){
  const sql=String(q.text||q);
  if(sql.includes("proveedores_fusiones_almacen"))return {rows:[
   {criterio:"mismo_codigo_erp_almacen",n:2},
   {criterio:"nombre_exacto_unico",n:3}
  ]};
  if(sql.includes("count(*)::int AS n"))return {rows:[{n:7}]};
  return {rows:[
   {sourceId:"20",sourceName:"Mismo Proveedor",sourceClass:"MAYORISTA",
    targetId:"10",targetName:"Mismo Proveedor",targetClass:"MAYORISTA",compatible:true},
   {sourceId:"20",sourceName:"Mismo Proveedor",sourceClass:"MAYORISTA",
    targetId:"12",targetName:"Mismo Proveedor",targetClass:"DIRECTO",compatible:false}
  ]};
 }};
 setupUnifiedSuppliers(app,pool,{requireTenant:()=>[],requireTenantAdmin:()=>[],requireTenantManager:()=>[]});
 let result,err;
 await routes["/api/tenant/proveedores-unificados/auditoria-almacen"]({
  context:{client:{slug:"ampedia"}}
 },{json(value){result=value}},e=>{err=e});
 if(err)throw err;
 assert.equal(result.merged,5);
 assert.equal(result.warehouseOnly,7);
 assert.equal(result.review.length,1);
 assert.equal(result.review[0].targets.length,2);
 assert.deepEqual(result.review[0].targets.map(x=>x.compatible),[true,false]);
});

test("se puede fusionar una ficha solo-almacén con la farmacia si son la misma entidad",async()=>{
 const routes={},statements=[];
 const app={get(){},post(path,...h){routes[path]=h.at(-1)},put(){}};
 const db={async query(sql,args){
  statements.push({sql:String(sql),args});
  if(String(sql).includes("FROM farmetrica.proveedores_unificados")&&
     String(sql).includes("FOR UPDATE"))return {rows:[
    {id:"20",nombre:"Proveedor A",clase:"MAYORISTA",activo:true},
    {id:"10",nombre:"Proveedor A",clase:"MAYORISTA",activo:true}
   ]};
  if(String(sql).startsWith("SELECT 1")&&String(sql).includes("nombre_proveedor_comparable"))
   return {rows:[{"?column?":1}]};
  return {rows:[],rowCount:1};
 },release(){}};
 setupUnifiedSuppliers(app,{connect:async()=>db},{
  requireTenant:()=>[],requireTenantAdmin:()=>[],requireTenantManager:()=>[]
 });
 let response,error;
 await routes["/api/tenant/proveedores-unificados/fusionar"]({
  body:{origenes:["20"],destino:"10",almacen:true},
  context:{client:{slug:"ampedia"}}
 },{json(v){response=v}},e=>{error=e});
 if(error)throw error;
 assert.equal(response.merged,1);
 assert.equal(response.target.id,"10");
 assert.ok(statements.some(x=>x.sql.includes("preparador_pedidos_globales")));
 assert.ok(statements.some(x=>x.sql.includes("proveedores_fusiones_almacen")));
 assert.ok(statements.some(x=>x.sql==="COMMIT"));
});

test("directorio incluye contador documental del mismo cliente sin cargar archivos",async()=>{
 let query;
 const pool={query:async q=>{query=q;return {rows:[{id:"1",documentCount:2}]}}};
 const result=await listUnifiedSuppliers(pool,ctx,[1],false);
 assert.equal(result[0].documentCount,2);
 assert.match(query.text,/FROM farmetrica\.proveedor_documentos doc/);
 assert.match(query.text,/doc\.cliente_slug=p\.cliente_slug AND doc\.proveedor_id=p\.id/);
 assert.deepEqual(query.values,["ampedia",[1]]);
});
