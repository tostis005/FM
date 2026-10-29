import test from "node:test";
import assert from "node:assert/strict";
import {latestLaboratoryCN,invalidateLastReceiptCache,lastReceiptMode} from "./preparadorLastReceipt.js";
import {listUnifiedSuppliers,readUnifiedSupplierCN} from "./unifiedSuppliers.js";
const ctx={client:{slug:"ampedia",schema:"ampedia"}};
test("selector y catálogo comparten única fuente por CN, sin laboratorios vacíos",async()=>{
 const old=process.env.FM_PREPARADOR_ULTIMA_RECEPCION;
 process.env.FM_PREPARADOR_ULTIMA_RECEPCION="1";
 try{
  const calls=[],pool={query:async q=>{
   const text=typeof q==="string"?q:q.text;
   calls.push(q);
   if(text.includes("FROM farmetrica.preparador_ultima_recepcion_estado"))return {rows:[]};
   if(text.includes("FROM farmetrica.preparador_exclusiones"))return {rows:[{cadena:"*BAJA*"}]};
   if(text.includes("p.id::text=ANY($2::text[])"))return {rows:[
    {id:"2",key:"P:2",name:"Lab último"}
   ]};
   return {rows:[{lab_id:"2",cn:"750001",nombre:"Medicamento"},
    {lab_id:"2",cn:"000123",nombre:"Parafarmacia"}]};
  }};
  const labs=await listUnifiedSuppliers(pool,ctx,[1,2],true);
  assert.deepEqual(labs.map(l=>l.key),["P:2"]);
  const result=await readUnifiedSupplierCN(pool,ctx,{key:"P:2",pharmacies:[2,1],type:"medicacion"});
  assert.deepEqual(result.rows.map(r=>r.cn),["750001"]);
  assert.equal((await readUnifiedSupplierCN(pool,ctx,{key:"P:1",pharmacies:[1,2],
   type:"medicacion"})).total,0);
  assert.equal((await readUnifiedSupplierCN(pool,ctx,{key:"P:2",pharmacies:[1,2],
   type:"parafarmacia"})).rows[0].cn,"000123");
  assert.equal(calls.filter(q=>(q.text||"").includes("DISTINCT ON (cn)")).length,1);
  const sql=calls.find(q=>(q.text||"").includes("DISTINCT ON (cn)")).text;
  assert.match(sql,/pm.ignorar_informes IS TRUE/);
  assert.match(sql,/pm.cooperativa IS TRUE/);
  assert.match(sql,/h.fecha/);
  assert.match(sql,/FROM received_with_cn/);
  assert.match(sql,/ORDER BY cn,fecha DESC/);
  assert.match(sql,/l.cantidad>0 AND l.devuelta IS NOT TRUE/);
  assert.match(sql,/FROM latest l JOIN scoped_cn s USING\(cn\)/);
  assert.match(sql,/excluded_cn AS MATERIALIZED/);
  assert.match(sql,/position\(upper\(exclude.cadena\) in upper\(coalesce\(ar.nombre/);
  assert.match(sql,/unnest\(\$3::text\[\]\)/);
  assert.deepEqual(calls.find(q=>(q.text||"").includes("DISTINCT ON (cn)")).values,
   ["ampedia",[1,2],["*BAJA*"]]);
  invalidateLastReceiptCache(pool,"ampedia");
  await latestLaboratoryCN(pool,ctx,[1,2]);
  assert.equal(calls.filter(q=>(q.text||"").includes("DISTINCT ON (cn)")).length,2);
 }finally{
  if(old===undefined)delete process.env.FM_PREPARADOR_ULTIMA_RECEPCION;
  else process.env.FM_PREPARADOR_ULTIMA_RECEPCION=old;
 }
});
test("rollback por variable de entorno restaura el catálogo anterior sin migraciones",()=>{
 const before=process.env.FM_PREPARADOR_ULTIMA_RECEPCION;
 process.env.FM_PREPARADOR_ULTIMA_RECEPCION="0";
 assert.equal(lastReceiptMode(),false);
 process.env.FM_PREPARADOR_ULTIMA_RECEPCION="1";
 assert.equal(lastReceiptMode(),true);
 if(before===undefined)delete process.env.FM_PREPARADOR_ULTIMA_RECEPCION;
 else process.env.FM_PREPARADOR_ULTIMA_RECEPCION=before;
});

test("selector evita agrupar todos los alias después de resolver CN",async()=>{
 const original=process.env.FM_PREPARADOR_ULTIMA_RECEPCION;
 process.env.FM_PREPARADOR_ULTIMA_RECEPCION="1";
 const queries=[],pool={query:async q=>{
  const sql=typeof q==="string"?q:q.text;
  queries.push(sql);
  if(sql.includes("FROM farmetrica.preparador_ultima_recepcion_estado"))
   return {rows:[{actualizado_en:new Date()}]};
  if(sql.includes("FROM farmetrica.preparador_ultima_recepcion_cache"))
   return {rows:[{lab_id:"5",cn:"450123",nombre:"Artículo válido"}]};
  if(sql.includes("p.id::text=ANY($2::text[])"))
   return {rows:[{id:"5",key:"P:5",name:"Fabricante"}]};
  throw Error("SQL inesperado");
 }};
 try{
  const rows=await listUnifiedSuppliers(pool,ctx,[1],true);
  assert.deepEqual(rows.map(r=>r.key),["P:5"]);
  assert.equal(queries.length,3);
  assert.ok(queries.every(sql=>!sql.includes("json_agg(json_build_object")));
  assert.ok(queries.every(sql=>!sql.includes("DISTINCT ON (cn)")));
 }finally{
  if(original===undefined)delete process.env.FM_PREPARADOR_ULTIMA_RECEPCION;
  else process.env.FM_PREPARADOR_ULTIMA_RECEPCION=original;
 }
});

test("snapshot persistente filtra por farmacia sin escanear el histórico",async()=>{
 const queries=[],pool={query:async q=>{
  queries.push(q);
  const sql=typeof q==="string"?q:q.text;
  if(sql.includes("FROM farmetrica.preparador_ultima_recepcion_estado"))
   return {rows:[{actualizado_en:new Date()}]};
  if(sql.includes("FROM farmetrica.preparador_ultima_recepcion_cache"))
   return {rows:[{lab_id:"21",cn:"700111",nombre:"Artículo reciente"}]};
  throw Error("El histórico no debe ejecutarse con snapshot preparado");
 }};
 const first=await latestLaboratoryCN(pool,ctx,[2,1]);
 assert.equal(first.total,1);
 assert.deepEqual([...first.byLab.keys()],["21"]);
 const sql=queries.find(q=>q.text?.includes("FROM farmetrica.preparador_ultima_recepcion_cache"));
 assert.match(sql.text,/pharmacy_ids && \$2::int\[\]/);
 assert.match(sql.text,/NOT \(blocked_pharmacy_ids && \$2::int\[\]\)/);
 assert.deepEqual(sql.values,["ampedia",[1,2]]);
 await latestLaboratoryCN(pool,ctx,[1,2]);
 assert.equal(queries.length,2,"La misma selección usa caché en memoria");
});
test("snapshot SQL mantiene última recepción global y exclusiones por farmacia",async()=>{
 const {readFile}=await import("node:fs/promises");
 const snapshot=await readFile(new URL("./preparadorLastReceiptSnapshot.sql",import.meta.url),"utf8");
 assert.match(snapshot,/SELECT DISTINCT ON \(cn\)/);
 assert.match(snapshot,/ORDER BY cn,fecha DESC/);
 assert.match(snapshot,/pm\.ignorar_informes IS TRUE/);
 assert.match(snapshot,/pm\.cooperativa IS TRUE/);
 assert.match(snapshot,/array_agg\(DISTINCT pharmacy_id\)::int\[\]/);
 assert.match(snapshot,/array_agg\(DISTINCT p\.pharmacy_id\)::int\[\]/);
 assert.match(snapshot,/position\(upper\(exclude\.cadena\) in upper\(coalesce\(ar\.nombre/);
 assert.doesNotMatch(snapshot,/WHERE\s+AND/);
});
