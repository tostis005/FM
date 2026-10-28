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
   if(text.includes("FROM farmetrica.preparador_exclusiones"))return {rows:[{cadena:"*BAJA*"}]};
   if(text.includes("json_agg(json_build_object"))return {rows:[
    {id:"1",key:"P:1",name:"Lab antiguo"},
    {id:"2",key:"P:2",name:"Lab último"},
    {id:"3",key:"P:3",name:"Sin CN"}
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

test("selector arranca consulta de últimas recepciones sin esperar a listado de proveedores",async()=>{
 const original=process.env.FM_PREPARADOR_ULTIMA_RECEPCION;
 process.env.FM_PREPARADOR_ULTIMA_RECEPCION="1";
 let releaseSuppliers,signalLatest;
 const latestStarted=new Promise(resolve=>{signalLatest=resolve});
 const suppliersPending=new Promise(resolve=>{releaseSuppliers=resolve});
 const pool={query:async q=>{
  const sql=typeof q==="string"?q:q.text;
  if(sql.includes("json_agg(json_build_object"))return suppliersPending;
  if(sql.includes("FROM farmetrica.preparador_exclusiones"))return {rows:[]};
  if(sql.includes("DISTINCT ON (cn)")){
   signalLatest();
   return {rows:[{lab_id:"5",cn:"450123",nombre:"Artículo válido"}]};
  }
  throw Error("SQL inesperado");
 }};
 let timer;
 try{
  const pending=listUnifiedSuppliers(pool,ctx,[1],true);
  // Si las consultas se hacen en serie, la última recepción no comenzaría
  // hasta que libere el listado de proveedores.
  await Promise.race([latestStarted,new Promise((_,reject)=>{
   timer=setTimeout(()=>reject(Error("Última recepción bloqueada por proveedores")),2500);
  })]);
  releaseSuppliers({rows:[{id:"5",key:"P:5",name:"Fabricante"}]});
  const rows=await pending;
  assert.deepEqual(rows.map(r=>r.key),["P:5"]);
 }finally{
  if(timer)clearTimeout(timer);
  releaseSuppliers({rows:[{id:"5",key:"P:5",name:"Fabricante"}]});
  if(original===undefined)delete process.env.FM_PREPARADOR_ULTIMA_RECEPCION;
  else process.env.FM_PREPARADOR_ULTIMA_RECEPCION=original;
 }
});
