import test from "node:test";
import assert from "node:assert/strict";
import {filterModeForColumn as mode} from "./tableFilterModes.js";
test("estados, familias y laboratorios utilizan selección",()=>{
 assert.equal(mode({label:"Estado",values:["Pendiente","Hecho"]}),"multi");
 assert.equal(mode({label:"Familia",values:["A","B"]}),"multi");
 assert.equal(mode({label:"Laboratorio",values:["A","B"]}),"multi");
});
test("texto libre, códigos y precios no se convierten en desplegables",()=>{
 assert.equal(mode({label:"Artículo",values:["uno","dos","tres","cuatro","cinco"]}),"text");
 assert.equal(mode({label:"Coste",values:["1","1","2","2","2","3"]}),"text");
 assert.equal(mode({label:"Artículo",values:["uno","uno","uno","dos","dos","dos"]}),"multi");
});
test("tablas remotas necesitan opciones de toda la consulta para seleccionar",()=>{
 assert.equal(mode({label:"Farmacia",remote:true,values:["A","B"]}),"text");
 assert.equal(mode({label:"Farmacia",remote:true,hasServerOptions:true}),"multi");
 assert.equal(mode({label:"Stock",declared:"text",hasServerOptions:true}),"text");
});
