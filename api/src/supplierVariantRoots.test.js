import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {variantRootCandidates,recoverSupplierVariantRoots} from "./supplierVariantRoots.js";
import {readSupplierMasterCatalogue} from "./supplierMasterCatalogue.js";
const ctx={client:{slug:"ampedia",schema:"ampedia"}};
const gift={referencia:"002853",cn:"002853",
 nombre:"LA ROCHE POSAY MELA B3 SERUM 30 ML R2 151130",
 tipo:"parafarmacia",pharmacyIds:"1,2"};
test("R2 con CN explícito recupera solo el padre real, sin confundir los CN del regalo",()=>{
 assert.deepEqual(variantRootCandidates([gift]),[
  {cn:"151130",base:"LA ROCHE POSAY MELA B3 SERUM 30 ML"}]);
 assert.deepEqual(variantRootCandidates([{...gift,nombre:"Producto R2"}]),[]);
 assert.deepEqual(variantRootCandidates([gift],"medicacion"),[]);
});
test("busca la raíz por ID Farmatic y farmacia; verifica nombre y CN original",async()=>{
 const queries=[];
 const pool={async query(q){
  queries.push(q);
  return {rows:[
   {cn:"151130",base:"LA ROCHE POSAY MELA B3 SERUM 30 ML",
    nombre:"LA ROCHE POSAY MELA B3 SERUM 30 ML",declared_cn:null,pharmacy_id:2,excluded:false},
   {cn:"151130",base:"LA ROCHE POSAY MELA B3 SERUM 30 ML",
    nombre:"LA ROCHE POSAY MELA B3 SERUM 30 ML",declared_cn:"",pharmacy_id:1,excluded:true},
   {cn:"151130",base:"LA ROCHE POSAY MELA B3 SERUM 30 ML",
    nombre:"Un producto diferente",declared_cn:null,pharmacy_id:3,excluded:false},
   {cn:"151130",base:"LA ROCHE POSAY MELA B3 SERUM 30 ML",
    nombre:"LA ROCHE POSAY MELA B3 SERUM 30 ML",declared_cn:"777777",pharmacy_id:4,excluded:false}
  ]};
 }};
 const result=await recoverSupplierVariantRoots(pool,ctx,{rows:[gift],pharmacies:[1,2],type:"parafarmacia"});
 assert.equal(result.length,2);
 assert.equal(result[0].cn,"002853","cada referencia conserva su CN individual");
 assert.equal(result[1].cn,"151130");
 assert.equal(result[1].pharmacyIds,"1,2");
 assert.equal(result[1].excluded,true);
 assert.match(queries[0].text,/a\.origen_id::text=c\.cn/);
 assert.match(queries[0].text,/f\.cliente_slug=\$1 AND f\.id=ANY\(\$2::int\[\]\)/);
 assert.deepEqual(queries[0].values.slice(0,2),["ampedia",[1,2]]);
});
test("un fallo temporal al resolver raíces no hace desaparecer los artículos originales",async()=>{
 const pool={query:async()=>{throw Object.assign(Error("timeout"),{code:"57014"})}};
 const result=await recoverSupplierVariantRoots(pool,ctx,{rows:[gift],pharmacies:[1],type:"parafarmacia"});
 assert.deepEqual(result,[gift]);
});
test("PostgreSQL: la raíz sin proveedor habitual y sin CN aparece mediante R2",{
 skip:!process.env.TEST_DB_URL
},async()=>{
 const db=new pg.Client({connectionString:process.env.TEST_DB_URL});
 await db.connect();
 try{
  await db.query("BEGIN");
  await db.query(`INSERT INTO ampedia.articulos
   (farmacia_codigo,origen_id,nombre,codigo_nacional,laboratorio,proveedor_habitual_id)
   VALUES('ABA','151130','LA ROCHE POSAY MELA B3 SERUM 30 ML',NULL,'P0508',NULL)`);
  const rows=await recoverSupplierVariantRoots(db,ctx,{rows:[gift],pharmacies:[1],type:"parafarmacia"});
  assert.ok(rows.some(row=>row.cn==="151130"&&row.nombre==="LA ROCHE POSAY MELA B3 SERUM 30 ML"));
 }finally{await db.query("ROLLBACK").catch(()=>{});await db.end()}
});

test("el catálogo no atribuye la raíz a partir de un regalo o un proveedor homónimo",async()=>{
 const seen=[];
 const pool={async query(q){
  seen.push(q);
  if(q.text?.includes("information_schema.columns"))
   return {rows:[{column_name:"proveedor_habitual_id"}]};
  if(q.text?.includes("FROM matched"))return {rows:[gift]};
  throw Error("No debe buscar otro artículo ni inferir su laboratorio");
 }};
 const rows=await readSupplierMasterCatalogue(pool,ctx,{id:"1162",pharmacies:[1],
  type:"parafarmacia",search:"151130",patterns:[]});
 assert.deepEqual(rows.map(r=>r.cn),["002853"]);
 assert.ok(!seen.some(q=>q.text?.includes("jsonb_to_recordset($3::jsonb)")));
 const catalogSQL=seen.find(q=>q.text?.includes("FROM matched")).text;
 assert.match(catalogSQL,/ua\.proveedor_id=\$3/);
 assert.match(catalogSQL,/winner\.lab_id<>\$3::bigint/);
 assert.doesNotMatch(catalogSQL,/other\.nombre/);
 assert.deepEqual(seen.find(q=>q.text?.includes("FROM matched")).values.slice(0,3),
  ["ampedia",[1],"1162"]);
});
