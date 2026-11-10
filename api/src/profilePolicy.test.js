import test from "node:test";
import assert from "node:assert/strict";
import {validateProfileDefinition,profileAllows,effectiveProfileModules,requestProfileOperation} from "./profilePolicy.js";
const candidate={name:"Gestor",baseRole:"gestor",modules:["promociones"],
 sections:["promociones","seguimiento-global"],permissions:{promociones:["ver","crear","editar","importar"]}};
test("Los permisos globales conservan lectura heredada y admiten nuevas operaciones",()=>{
 assert.equal(profileAllows(null,"promociones","eliminar"),true);
 assert.equal(profileAllows(candidate.permissions,"promociones","editar"),true);
 assert.equal(profileAllows(candidate.permissions,"promociones","eliminar"),false);
 assert.deepEqual(effectiveProfileModules({promociones:true,compras:true},candidate.permissions),
  {promociones:true,compras:false});
});
test("La matriz nunca acepta módulos ajenos, acciones repetidas o escrituras sin lectura",()=>{
 assert.deepEqual(validateProfileDefinition(candidate,["promociones"]),candidate);
 assert.equal(validateProfileDefinition({...candidate,sections:["stock"]},["promociones"]),null);
 assert.equal(validateProfileDefinition({...candidate,permissions:{promociones:["crear"]}},["promociones"]),null);
 assert.equal(validateProfileDefinition({...candidate,permissions:{promociones:["ver","ver"]}},["promociones"]),null);
 assert.equal(validateProfileDefinition({...candidate,modules:["proveedores"]},["promociones"]),null);
 assert.equal(validateProfileDefinition({...candidate,modules:null,sections:null},["promociones"])?.modules,null);
});
test("Distingue importación, borrado, activación y guardado de promociones",()=>{
 const action=(method,path)=>requestProfileOperation({method,path});
 assert.deepEqual(action("POST","/api/tenant/promociones/importar"),{module:"promociones",operations:["importar"]});
 assert.deepEqual(action("POST","/api/tenant/promociones/eliminar-lote"),{module:"promociones",operations:["eliminar"]});
 assert.deepEqual(action("POST","/api/tenant/promociones/activar-lote"),{module:"promociones",operations:["editar"]});
 assert.deepEqual(action("PUT","/api/tenant/promociones/123"),{module:"promociones",operations:["crear","editar"]});
 assert.equal(action("GET","/api/tenant/promociones"),null);
});
