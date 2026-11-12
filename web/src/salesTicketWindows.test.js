import test from "node:test";
import assert from "node:assert/strict";
import {salesTicketWindows,mergeSalesTicketCounts,mapTicketWindows} from "./salesTicketWindows.js";
test("periodos cortos: una sola consulta",()=>{
 assert.deepEqual(salesTicketWindows("2025-11-12","2026-11-12"),
  [{from:"2025-11-12",to:"2026-11-12"}]);
});
test("24 meses: subconsultas anuales continuas sin solapamiento",()=>{
 assert.deepEqual(salesTicketWindows("2024-12-01","2026-11-12"),[
  {from:"2024-12-01",to:"2024-12-31"},
  {from:"2025-01-01",to:"2025-12-31"},
  {from:"2026-01-01",to:"2026-11-12"}]);
});
test("combina tickets sin duplicar farmacias ni cambiar el total",()=>{
 const combined=mergeSalesTicketCounts([
  {tickets:7,pharmacies:[{id:"1",name:"Uno",tickets:5},{id:"2",name:"Dos",tickets:2}]},
  {tickets:12,pharmacies:[{id:"1",name:"Uno",tickets:7},{id:"2",name:"Dos",tickets:5}]}
 ]);
 assert.deepEqual(combined,{tickets:19,pharmacies:[
  {id:"1",name:"Uno",tickets:12},{id:"2",name:"Dos",tickets:7}]});
});
test("limita consultas simultáneas y conserva el orden",async()=>{
 const windows=[0,1,2,3,4,5];let running=0,max=0;
 const result=await mapTicketWindows(windows,async n=>{
  running++;max=Math.max(max,running);
  await new Promise(resolve=>setTimeout(resolve,1));
  running--;return n*2;
 });
 assert.deepEqual(result,[0,2,4,6,8,10]);
 assert.equal(max,2);
});
