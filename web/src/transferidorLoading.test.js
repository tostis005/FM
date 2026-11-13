import test from "node:test";
import assert from "node:assert/strict";
import {transferidorCalculating,transferidorWaitingForFirstRows} from "./transferidorLoading.js";

test("bloquea tabla y KPIs antes del primer lote",()=>{
 assert.equal(transferidorWaitingForFirstRows(null),true);
 for(const status of ["queued","inventory","calculating"]){
  assert.equal(transferidorCalculating(status),true);
  assert.equal(transferidorWaitingForFirstRows({status,rows:[],total:0}),true);
 }
});
test("libera tabla y KPIs al aparecer el primer movimiento, sin esperar al final",()=>{
 const partial={status:"calculating",progress:{done:1,total:5},
  rows:[{id:"123456:1:2",units:5}],total:1};
 assert.equal(transferidorWaitingForFirstRows(partial),false);
 assert.equal(transferidorWaitingForFirstRows({...partial,progress:{done:2,total:5}}),false);
});
test("sin movimientos, libera los indicadores al completar el cálculo",()=>{
 for(const status of ["complete","partial"]){
  assert.equal(transferidorCalculating(status),false);
  assert.equal(transferidorWaitingForFirstRows({status,rows:[],total:0}),false);
 }
});
test("error quita el spinner para mostrar la incidencia",()=>{
 assert.equal(transferidorWaitingForFirstRows(null,"Error de red"),false);
 assert.equal(transferidorWaitingForFirstRows({status:"calculating",rows:[]},"Fallo"),false);
});
test("si la página aún no tiene filas, mantiene bloqueo hasta resultados o final",()=>{
 assert.equal(transferidorWaitingForFirstRows({status:"calculating",rows:[],total:10}),true);
 assert.equal(transferidorWaitingForFirstRows({status:"complete",rows:[],total:10}),false);
});
