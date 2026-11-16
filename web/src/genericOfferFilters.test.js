import test from "node:test";
import assert from "node:assert/strict";
import {filterGenericOfferGroups,genericOfferOptions} from "./genericOfferFilters.js";

const items=[
 {dcpf:"10",principle:"PARACETAMOL",name:"Paracetamol 500 mg 20 comprimidos",strength:"500 mg",form:"Comprimidos",pack:"20 comprimidos",laboratories:3,cns:["659407"]},
 {dcpf:"11",principle:"PARACETAMOL",name:"Paracetamol 1 g 20 comprimidos",strength:"1 g",form:"Comprimidos",pack:"20 comprimidos",laboratories:2},
 {dcpf:"12",principle:"PARACETAMOL",name:"Paracetamol 500 mg 20 sobres",strength:"500 mg",form:"Sobres",pack:"20 sobres",laboratories:1},
 {dcpf:"20",principle:"OMEPRAZOL",name:"Omeprazol 20 mg 28 cápsulas",strength:"20 mg",form:"Cápsulas",pack:"28 cápsulas",laboratories:4}
];
test("escoger solo la molécula muestra todas sus dosis y formatos",()=>{
 assert.deepEqual(filterGenericOfferGroups(items,{principle:"PARACETAMOL"}).map(x=>x.dcpf),["10","11","12"]);
});
test("acotar dosis y forma conserva solo los conjuntos clínicos correctos",()=>{
 assert.deepEqual(filterGenericOfferGroups(items,{principle:"PARACETAMOL",strength:"500 mg",form:"Comprimidos"}).map(x=>x.dcpf),["10"]);
});
test("texto libre por CN, molécula o descripción sin acentos ni orden obligatorio",()=>{
 assert.deepEqual(filterGenericOfferGroups(items,{text:"500 PARACETAMOL"}).map(x=>x.dcpf),["10","12"]);
 assert.deepEqual(filterGenericOfferGroups(items,{text:"omeprazol cápsulas"}).map(x=>x.dcpf),["20"]);
 assert.deepEqual(filterGenericOfferGroups(items,{text:"659407"}).map(x=>x.dcpf),["10"]);
 assert.deepEqual(genericOfferOptions(items.filter(x=>x.principle==="PARACETAMOL"),"strength"),["1 g","500 mg"]);
});
