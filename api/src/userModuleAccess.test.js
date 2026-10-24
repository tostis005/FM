import test from "node:test";
import assert from "node:assert/strict";
import {effectiveUserModules,validateModuleGrants,requestModules} from "./userModuleAccess.js";
const enabled=[{id:"ventas",enabled:true},{id:"compras",enabled:true},{id:"promociones",enabled:false}];
test("permisos = intersección con módulos del cliente; NULL hereda para usuarios antiguos",()=>{
 assert.deepEqual(effectiveUserModules(enabled,["ventas","promociones"]),{ventas:true,compras:false,promociones:false});
 assert.deepEqual(effectiveUserModules(enabled,[]),{ventas:false,compras:false,promociones:false});
 assert.deepEqual(effectiveUserModules(enabled,null),{ventas:true,compras:true,promociones:false});
 assert.deepEqual(effectiveUserModules(enabled,undefined),{ventas:true,compras:true,promociones:false});
 assert.deepEqual(effectiveUserModules(enabled,[],true),{ventas:true,compras:true,promociones:false});
});
test("no se pueden delegar módulos deshabilitados, desconocidos o duplicados",()=>{
 assert.deepEqual(validateModuleGrants(["ventas","compras"],enabled),["ventas","compras"]);
 assert.deepEqual(validateModuleGrants([],enabled),[]);
 assert.equal(validateModuleGrants(["promociones"],enabled),null);
 assert.equal(validateModuleGrants(["asistente"],enabled),null);
 assert.equal(validateModuleGrants(["ventas","ventas"],enabled),null);
 assert.equal(validateModuleGrants("ventas",enabled),null);
 assert.equal(validateModuleGrants(["compras"],enabled,["ventas"]),null);
});
test("las rutas sensibles no evitan permisos cambiando la URL",()=>{
 const m=(path,query={})=>requestModules({path,query});
 assert.deepEqual(m("/api/analytics/pedidos/propuesta"),["compras"]);
 assert.deepEqual(m("/api/analytics/ventas/resumen"),["ventas","dashboard"]);
 assert.deepEqual(m("/api/analytics/pantallas/stock-historico"),["stock"]);
 assert.deepEqual(m("/api/analytics/pantallas/ventas-tickets/lineas"),["ventas"]);
 assert.deepEqual(m("/api/analytics/reportes",{modulo:"rentabilidad"}),["rentabilidad"]);
 assert.deepEqual(m("/api/asistente/chat/stream"),["asistente"]);
 assert.deepEqual(m("/api/analytics/catalogos/proveedores"),["compras","proveedores"]);
 assert.deepEqual(m("/api/tenant/usuarios"),[]);
});
