import test from "node:test";
import assert from "node:assert/strict";
import {ticketLineAmounts} from "./ticketLineAmounts.js";

test("bruto y descuento porcentual se calculan a partir de neto + descuento",()=>{
 const amounts=ticketLineAmounts({pvp:12,quantity:2,net:16,lineDiscount:4,gross:0});
 assert.deepEqual(amounts,{
   pvp:12,quantity:2,gross:20,lineDiscount:4,net:16,discountRate:0.2
 });
});

test("devoluciones negativas en pantalla y positivas solo en Excel sin mutar el origen",()=>{
 const refund={pvp:10,quantity:-2,net:-16,lineDiscount:-4};
 assert.deepEqual(ticketLineAmounts(refund),{
  pvp:10,quantity:-2,gross:-20,lineDiscount:-4,net:-16,discountRate:0.2
 });
 assert.deepEqual(ticketLineAmounts(refund,{absolute:true}),{
  pvp:10,quantity:2,gross:20,lineDiscount:4,net:16,discountRate:0.2
 });
 assert.equal(refund.quantity,-2);
 assert.equal(refund.net,-16);
 assert.equal(refund.lineDiscount,-4);
});

test("el signo de una devolución se mantiene también con descuento positivo en origen",()=>{
 const refund={pvp:10,quantity:-2,net:-16,lineDiscount:4};
 assert.deepEqual(ticketLineAmounts(refund),{
  pvp:10,quantity:-2,gross:-20,lineDiscount:-4,net:-16,discountRate:0.2
 });
});

test("descuento cero conocido muestra 0 %; descuento desconocido queda vacío",()=>{
 const known=ticketLineAmounts({pvp:15,quantity:1,net:15,lineDiscount:0});
 assert.equal(known.gross,15);
 assert.equal(known.discountRate,0);
 const unknown=ticketLineAmounts({pvp:15,quantity:1,net:12,lineDiscount:null});
 assert.equal(unknown.gross,15);
 assert.equal(unknown.lineDiscount,null);
 assert.equal(unknown.discountRate,null);
});

test("bruto sin neto ni descuento utiliza PVP por cantidad sin inventar porcentaje",()=>{
 const a=ticketLineAmounts({pvp:8,quantity:3,net:null,lineDiscount:null});
 assert.equal(a.gross,24);
 assert.equal(a.discountRate,null);
 const b=ticketLineAmounts({pvp:null,quantity:null,net:null,lineDiscount:null,gross:null});
 assert.equal(b.gross,null);
 assert.equal(b.discountRate,null);
});

test("el porcentaje no divide por cero",()=>{
 const a=ticketLineAmounts({pvp:0,quantity:0,net:0,lineDiscount:0});
 assert.equal(a.gross,0);
 assert.equal(a.discountRate,null);
});
