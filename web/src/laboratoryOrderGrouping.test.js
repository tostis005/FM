import test from "node:test";
import assert from "node:assert/strict";
import {parseLaboratoryVariant,groupedLaboratoryRows} from "./laboratoryOrderGrouping.js";

const rows=[
 {referencia:"234567",cn:"234567",nombre:"Crema Solar SPF 50"},
 {referencia:"111111",cn:"111111",nombre:"Crema Solar SPF 50 R2 234567"},
 {referencia:"888888",cn:"888888",nombre:"Crema Solar SPF 50 DUPLO 2"},
 {referencia:"999999",cn:"999999",nombre:"Otra loción"},
 {referencia:"111110",cn:"111110",nombre:"Crema Solar SPF 50 R1"},
 {referencia:"123123",cn:"123123",nombre:"Otra loción DUPLO 3"}
];
test("R1/R2 se asocian por CN explícito o nombre exacto sin mezclar unidades",()=>{
 assert.equal(parseLaboratoryVariant(rows[1]).rootCode,"234567");
 const groups=groupedLaboratoryRows(rows);
 const family=groups.find(g=>g.representative.cn==="234567");
 assert.deepEqual(family.rows.map(r=>r.cn),["234567","111110","111111","888888"]);
 assert.deepEqual(family.rows.map(r=>r._visualLabel),
  ["Producto base","Regalo R1","Regalo R2","Dúplo ×2"]);
 assert.equal(groups.length,3);
 assert.equal(family.rows[0]._visualGroupFirst,true);
 assert.equal(family.rows.at(-1)._visualGroupLast,true);
 assert.deepEqual(rows.map(r=>r.cn),["234567","111111","888888","999999","111110","123123"],
  "El algoritmo nunca modifica las filas originales");
});
test("si el CN indicado existe, prevalece sobre nombre distinto",()=>{
 const result=groupedLaboratoryRows([
  {referencia:"001234",cn:"001234",nombre:"Producto base"},
  {referencia:"444444",cn:"444444",nombre:"Otro título R3 001234"}
 ]);
 assert.equal(result.length,1);
 assert.equal(result[0].rows[1]._visualLabel,"Regalo R3");
});
test("los dúplos y versiones R sin raíz segura no se asocian a otros productos",()=>{
 const independent=groupedLaboratoryRows([
  {referencia:"1",cn:"111111",nombre:"Crema hidratante 100 ml"},
  {referencia:"2",cn:"222222",nombre:"Crema hidratante 200 ml DUPLO 2"},
  {referencia:"3",cn:"333333",nombre:"Crema hidratante R1 999999"}
 ]);
 assert.equal(independent.length,3);
 assert.equal(parseLaboratoryVariant({nombre:"Crema DUPLO 3"}),null);
 assert.equal(parseLaboratoryVariant({nombre:"Crema Rinol"}),null);
});
test("las familias siguen juntas con ordenación por CN ascendente o descendente",()=>{
 for(const sort of ["cn:asc","cn:desc","article:asc","article:desc"]){
  const groups=groupedLaboratoryRows(rows,sort);
  const flat=groups.flatMap(g=>g.rows);
  const i=flat.findIndex(r=>r.cn==="234567");
  assert.deepEqual(flat.slice(i,i+4).map(r=>r.cn),
   ["234567","111110","111111","888888"]);
 }
});
test("dos variantes sin raíz pueden asociarse si comparten exactamente prefijo",()=>{
 const groups=groupedLaboratoryRows([
  {referencia:"a",cn:"222222",nombre:"Crema R1"},
  {referencia:"b",cn:"333333",nombre:"Crema R2"}
 ]);
 assert.equal(groups.length,1);
 assert.deepEqual(groups[0].rows.map(r=>r._visualLabel),["Regalo R1","Regalo R2"]);
});
