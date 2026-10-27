import test from "node:test";
import assert from "node:assert/strict";
import {copyUserPermissions} from "./userPermissionCopy.js";

const scope={modules:[{id:"ventas"},{id:"compras"}],
 sections:[{id:"ventas",module:"ventas"},{id:"ventas-tickets",module:"ventas"},
  {id:"compras-preparador",module:"compras"}],
 grantableModules:["ventas","compras"],
 grantableSections:["ventas","ventas-tickets","compras-preparador"],
 pharmacies:[{id:"1"},{id:"2"}]};
const recipient={email:"destino@example.com",name:"Destino",authType:"local",
 active:false,role:"farmacia",pharmacies:["1"],modules:[],sections:[]};
test("copia rol, farmacias, módulos y subsecciones; mantiene identidad y credenciales",()=>{
 const source={email:"origen@example.com",name:"Origen",authType:"google",active:true,
  role:"gestor",pharmacies:["2"],modules:["ventas"],sections:["ventas-tickets"]};
 const copy=copyUserPermissions(source,recipient,scope);
 assert.deepEqual(copy,{...recipient,role:"gestor",pharmacies:["2"],
  modules:["ventas"],sections:["ventas-tickets"]});
 assert.deepEqual(recipient.modules,[]);
 assert.equal(source.email,"origen@example.com");
});
test("alta nueva toma permisos del origen sin copiar su identidad",()=>{
 const source={email:"origen@example.com",role:"farmacia",pharmacies:["1","2"],
  modules:["compras"],sections:["compras-preparador"]};
 const newcomer={...recipient,email:"nueva@example.com",name:"Nuevo",active:true};
 const copy=copyUserPermissions(source,newcomer,scope);
 assert.equal(copy.email,"nueva@example.com");
 assert.equal(copy.name,"Nuevo");
 assert.deepEqual(copy.sections,["compras-preparador"]);
});
test("cuentas antiguas con permisos NULL heredan las secciones del módulo activo",()=>{
 const source={email:"origen@example.com",role:"farmacia",pharmacies:["1"],
  modules:["ventas"],sections:null};
 const copy=copyUserPermissions(source,recipient,scope);
 assert.deepEqual(copy.sections,["ventas","ventas-tickets"]);
 const inherited=copyUserPermissions({...source,modules:null,sections:null},recipient,scope);
 assert.deepEqual(inherited.modules,["ventas","compras"]);
 assert.deepEqual(inherited.sections,["ventas","ventas-tickets","compras-preparador"]);
});
test("deniega copiar roles, módulos o subsecciones superiores al gestor",()=>{
 const source={email:"origen@example.com",role:"administrador",pharmacies:["1"],
  modules:["ventas"],sections:["ventas"]};
 const manager={...scope,allowedRoles:["farmacia","colaborador"]};
 assert.throws(()=>copyUserPermissions(source,recipient,manager),/rol/);
 assert.throws(()=>copyUserPermissions({...source,role:"farmacia"},recipient,
  {...scope,grantableModules:["compras"]}),/módulos/);
 assert.throws(()=>copyUserPermissions({...source,role:"farmacia"},recipient,
  {...scope,grantableSections:["ventas-tickets"]}),/subsecciones/);
});
test("deniega copiar farmacias ajenas y elegir la misma cuenta",()=>{
 const source={email:"origen@example.com",role:"farmacia",pharmacies:["999"],modules:[],sections:[]};
 assert.throws(()=>copyUserPermissions(source,recipient,scope),/farmacias/);
 assert.throws(()=>copyUserPermissions({...source,email:recipient.email},recipient,scope),/otro usuario/);
});
test("omitir módulos retirados no reactiva pantallas fuera del plan",()=>{
 const source={email:"origen@example.com",role:"farmacia",pharmacies:["1"],
  modules:["ventas","antiguo"],sections:["ventas-tickets","deshabilitada"]};
 const copy=copyUserPermissions(source,recipient,scope);
 assert.deepEqual(copy.modules,["ventas"]);
 assert.deepEqual(copy.sections,["ventas-tickets"]);
});
