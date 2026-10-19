import test from "node:test";
import assert from "node:assert/strict";
import {readSharedReportFilters,updateSharedReportFilters,initializeSharedReportFilters} from "./sharedReportFilters.js";

const data=new Map();
Object.defineProperty(globalThis,"sessionStorage",{configurable:true,value:{
 getItem:key=>data.get(key)??null,
 setItem:(key,value)=>data.set(key,String(value)),
 removeItem:key=>data.delete(key)
}});

test("período y farmacias se comparten entre pantallas del mismo cliente",()=>{
 data.clear();
 initializeSharedReportFilters("cliente-a",{period:"6",pharmacyIds:["1","2"],customFrom:"",customTo:""});
 assert.deepEqual(readSharedReportFilters("cliente-a"),{
  period:"6",pharmacyIds:["1","2"],customFrom:"",customTo:""});
 updateSharedReportFilters("cliente-a",{period:"this_year",pharmacyIds:["2","2"]});
 assert.deepEqual(readSharedReportFilters("cliente-a").pharmacyIds,["2"]);
 assert.equal(readSharedReportFilters("cliente-a").period,"this_year");
 initializeSharedReportFilters("cliente-a",{period:"3",pharmacyIds:[]});
 assert.equal(readSharedReportFilters("cliente-a").period,"this_year");
 assert.deepEqual(readSharedReportFilters("cliente-a").pharmacyIds,["2"]);
 assert.deepEqual(readSharedReportFilters("cliente-b"),{});
});

test("un período no admitido en una pantalla no destruye la selección global",()=>{
 data.clear();
 updateSharedReportFilters("cliente-a",{period:"all",pharmacyIds:["1"]});
 assert.deepEqual(readSharedReportFilters("cliente-a",new Set(["today","this_year"])),{pharmacyIds:["1"]});
 initializeSharedReportFilters("cliente-a",{period:"this_year",pharmacyIds:["2"]});
 assert.equal(readSharedReportFilters("cliente-a").period,"all");
});

test("fechas personalizadas se conservan y se validan",()=>{
 data.clear();
 updateSharedReportFilters("cliente-a",{
  period:"custom",customFrom:"2026-01-01",customTo:"2026-10-19",pharmacyIds:["1",null,1,"2","2"]});
 assert.deepEqual(readSharedReportFilters("cliente-a"),{
  period:"custom",customFrom:"2026-01-01",customTo:"2026-10-19",pharmacyIds:["1","2"]});
 updateSharedReportFilters("cliente-a",{customTo:"incorrecto"});
 assert.equal(readSharedReportFilters("cliente-a").customTo,"");
});
