import test from "node:test";
import assert from "node:assert/strict";
import {applyCanonicalDescriptions,canonicalizeLaboratoryCatalog} from "./laboratoryCanonicalDescriptions.js";

const ctx={client:{slug:"ampedia",schema:"ampedia"}};
const medication=[
 {referencia:"654698",cn:"654698",
  nombre:"IBUPROFENO (ARGININA) CINFA EFG 400 MG 30 SOBRES GRANULADO PARA SOLUCION ORAL",
  excluded:true,inReceipts:true},
 {referencia:"655872",cn:"655872",
  nombre:"PARACETAMOL CINFA EFG 1 G 40 SOBRES EFERVESCE*C*",
  excluded:true,inReceipts:true},
 {referencia:"655873",cn:"655873",nombre:"ZZZ producto antiguo",excluded:true}
];

test("654698 y 655872: sin *BAJA* visible no son rojos aunque otra farmacia los marcara",()=>{
 const selected=new Map([
  ["654698","IBUPROFENO (ARGININA) CINFA EFG 400 MG 30 SOBRES GRANULADO PARA SOLUCION ORAL"],
  ["655872","PARACETAMOL CINFA EFG 1 G 40 SOBRES EFERVESCE*C*"]
 ]);
 const rows=applyCanonicalDescriptions(medication,selected,["*BAJA*"]);
 assert.equal(rows.length,medication.length);
 assert.deepEqual(rows.map(r=>r.excluded),[false,false,false]);
 assert.equal(rows[0].nombre,selected.get("654698"));
 assert.equal(rows[1].nombre,selected.get("655872"));
 assert.ok(rows.every(r=>r.inReceipts===true||r.referencia==="655873"));
 assert.equal(medication[0].excluded,true,"El catálogo original no se modifica");
});

test("la regla guardada se aplica SOLO a la descripción canónica, nunca a nombres alternativos",()=>{
 const source=[
  {referencia:"654698",cn:"654698",nombre:"*BAJA* NOMBRE DE OTRA FARMACIA",excluded:true},
  {referencia:"655872",cn:"655872",nombre:"PRODUCTO SIN BAJA",excluded:false}
 ];
 const names=new Map([
  ["654698","IBUPROFENO CINFA EFG 400 MG"],
  ["655872","PARACETAMOL CINFA *BAJA*"]
 ]);
 const rows=applyCanonicalDescriptions(source,names,["*BAJA*"]);
 assert.equal(rows[0].excluded,false);
 assert.equal(rows[0].nombre,"IBUPROFENO CINFA EFG 400 MG");
 assert.equal(rows[1].excluded,true);
 assert.equal(rows[1].nombre,"PARACETAMOL CINFA *BAJA*");
});

test("nombre canónico: el SQL busca en Abadía para medicación",async()=>{
 const statements=[];
 const pool={async query(q){
  statements.push(q);
  if(q.text.includes("information_schema.columns"))return {rows:[{available:true}]};
  assert.match(q.text,/WITH canonical_pharmacy AS MATERIALIZED/);
  assert.match(q.text,/codigo_origen\)\)='ABA'/);
  assert.match(q.text,/ORDER BY cn,priority,match_priority,nombre/);
  assert.match(q.text,/a\.cn_normalizado/);
  assert.deepEqual(q.values,["ampedia",["654698","655872"],"medicacion"]);
  return {rows:[{cn:"654698",nombre:"Nombre de Abadía"},
   {cn:"655872",nombre:"Otro nombre de Abadía"}]};
 }};
 const result=await canonicalizeLaboratoryCatalog(pool,ctx,{
  rows:medication.slice(0,2),total:2
 },"medicacion",["*BAJA*"]);
 assert.equal(result.total,2);
 assert.deepEqual(result.rows.map(r=>r.nombre),
  ["Nombre de Abadía","Otro nombre de Abadía"]);
 assert.deepEqual(result.rows.map(r=>r.excluded),[false,false]);
 assert.equal(statements.length,2);
});

test("almacén ALMACEN tiene preferencia sobre AMP y el catálogo conserva los CN ausentes",async()=>{
 const pool={async query(q){
  if(q.text.includes("information_schema.columns"))return {rows:[{available:false}]};
  assert.match(q.text,/tipo_establecimiento='almacen'/);
  assert.match(q.text,/SELECT 'AMP'::text AS code,1 AS priority/);
  assert.doesNotMatch(q.text,/a\.cn_normalizado/);
  assert.deepEqual(q.values,["ampedia",["000123","000124"],"parafarmacia"]);
  return {rows:[{cn:"000123",nombre:"Crema almacén *BAJA*"}]};
 }};
 const result=await canonicalizeLaboratoryCatalog(pool,ctx,{rows:[
  {referencia:"000123",cn:"000123",nombre:"Crema farmacia",excluded:false},
  {referencia:"000124",cn:"000124",nombre:"Otro CN",excluded:true}
 ],total:2},"parafarmacia",["*BAJA*"]);
 assert.equal(result.rows[0].nombre,"Crema almacén *BAJA*");
 assert.equal(result.rows[0].excluded,true);
 assert.equal(result.rows[1].nombre,"Otro CN");
 assert.equal(result.rows[1].excluded,false);
});

test("sin reglas configuradas: ninguna descripción se marca en rojo",()=>{
 const names=new Map([["654698","ZZZ IBUPROFENO *BAJA*"]]);
 assert.equal(applyCanonicalDescriptions(medication,names,[]).every(r=>!r.excluded),true);
});
