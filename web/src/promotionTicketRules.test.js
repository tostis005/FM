import test from "node:test";
import assert from "node:assert/strict";
import {eligiblePromotionLines,promotionTicketPolicy} from "./promotionTicketRules.js";

const base={id:"P1",name:"Campaña",type:"dos_por_uno",cns:["001474"]};
const sale=(quantity,other={})=>({
 pharmacyId:"1",ticket:"T-12",at:"2026-10-15T10:00:00Z",
 cn:"001474",pvp:10,quantity,net:quantity*10,lineDiscount:0,...other
});
const apply=(promo,lines,simulate=true)=>eligiblePromotionLines({...base,...promo},lines,{simulate});
const sum=(rows,key)=>rows.reduce((n,row)=>n+(row[key]||0),0);

test("2x1: una unidad aislada no cuenta, ni aunque aparezca en varios tickets",()=>{
 assert.deepEqual(apply({},[sale(1)]),[]);
 assert.deepEqual(apply({},[sale(1,{ticket:"A"}),sale(1,{ticket:"B"})]),[]);
 assert.deepEqual(apply({},[sale(1,{pharmacyId:"1"}),sale(1,{pharmacyId:"2"})]),[]);
 assert.deepEqual(apply({},[sale(1),sale(1,{at:"2026-10-16T10:00:00Z"})]),[]);
});

test("2x1: dos líneas de una unidad equivalen a una línea de dos",()=>{
 for(const lines of [[sale(2,{net:20})],[sale(1),sale(1)]]){
  const result=apply({},lines);
  assert.equal(sum(result,"quantity"),2);
  assert.equal(sum(result,"gross"),20);
  assert.equal(sum(result,"lineDiscount"),10);
  assert.equal(sum(result,"net"),10);
 }
});

test("el Excel real conserva cobros y el simulado los sustituye sin mutar Farmatic",()=>{
 const lines=[sale(2,{net:18,lineDiscount:2})];
 assert.equal(sum(apply({},lines,false),"net"),18);
 assert.equal(sum(apply({},lines,true),"net"),10);
 assert.equal(lines[0].net,18);
 assert.equal(lines[0].lineDiscount,2);
});

test("3x2 requiere tres, admite CN distintos y solo cuenta lotes completos",()=>{
 assert.deepEqual(apply({type:"tres_por_dos"},[sale(2)]),[]);
 const lines=[sale(1),sale(1,{cn:"002222",pvp:20,net:20}),sale(1,{pvp:5,net:5})];
 const applied=apply({type:"tres_por_dos",cns:["001474","002222"]},lines);
 assert.equal(sum(applied,"quantity"),3);
 assert.equal(sum(applied,"gross"),35);
 assert.equal(sum(applied,"lineDiscount"),5);
 assert.equal(sum(applied,"net"),30);
 assert.equal(sum(apply({type:"tres_por_dos"},[sale(4,{net:40})]),"quantity"),3);
});

test("2x1 con cinco unidades no introduce la quinta unidad suelta",()=>{
 const result=apply({},[sale(5,{net:50})]);
 assert.equal(sum(result,"quantity"),4);
 assert.equal(sum(result,"gross"),40);
 assert.equal(sum(result,"lineDiscount"),20);
 assert.equal(sum(result,"net"),20);
});

test("descuento en segunda unidad: % y euros solo al tener pareja",()=>{
 assert.deepEqual(apply({type:"segunda_porcentaje",discountPercent:50},[sale(1)]),[]);
 const pct=apply({type:"segunda_porcentaje",discountPercent:50},[sale(2,{net:20})]);
 assert.equal(sum(pct,"net"),15);
 const euro=apply({type:"segunda_importe",discountAmount:3},[sale(2,{net:20})]);
 assert.equal(sum(euro,"net"),17);
});

test("porcentaje y descuento fijo de primera unidad funcionan en tickets de uno",()=>{
 assert.equal(sum(apply({type:"descuento_porcentaje",discountPercent:20},[sale(1)]),"net"),8);
 assert.equal(sum(apply({type:"descuento_importe",discountAmount:3},[sale(1)]),"net"),7);
});

test("packs 4+1 y descuento escalonado exigen sus umbrales",()=>{
 const pack={type:"otras_unidades",formula:"4+1"};
 assert.deepEqual(apply(pack,[sale(4)]),[]);
 const result=apply(pack,[sale(5,{net:50})]);
 assert.equal(sum(result,"net"),40);
 const tier={type:"escalonado",formula:"20% por 1 UD y 30% 2UDS O MAS"};
 assert.equal(sum(apply(tier,[sale(1)]),"net"),8);
 assert.equal(sum(apply(tier,[sale(2,{net:20})]),"net"),14);
});

test("las reglas no determinadas se rechazan y no se inventan regalos",()=>{
 assert.throws(()=>promotionTicketPolicy({...base,type:"sin_clasificar"}),/no tiene condiciones/);
 assert.throws(()=>promotionTicketPolicy({...base,type:"regalo",formula:"Regalo con la compra"}),/no tiene condiciones/);
});

test("devoluciones reducen las unidades elegibles, sin generar descuento simulado por sí solas",()=>{
 assert.deepEqual(apply({},[sale(-2,{net:-20,lineDiscount:0})]),[]);
 assert.deepEqual(apply({},[sale(2),sale(-1,{net:-10,lineDiscount:0})]),[]);
});
