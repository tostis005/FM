import test from "node:test";
import assert from "node:assert/strict";
import {canManageProfileRole,canEditGlobalProfile,profileWithinManagerScope} from "./profileManagementPolicy.js";
const context={role:"gestor",modules:{promociones:true,compras:false},
 sections:{promociones:true,"seguimiento-global":true},profilePermissions:{promociones:["ver","editar","exportar"]}};
const basic={baseRole:"farmacia",modules:["promociones"],sections:["promociones","seguimiento-global"],
 permissions:{promociones:["ver","exportar"]}};
test("Los gestores editan perfiles de personal, no administrativos ni perfiles de otros clientes",()=>{
 assert.equal(canManageProfileRole("gestor","farmacia"),true);
 assert.equal(canManageProfileRole("gestor","gestor"),false);
 assert.equal(canManageProfileRole("administrador","gestor"),true);
 assert.equal(canManageProfileRole("administrador","administrador"),false);
 assert.equal(canManageProfileRole("superadministrador","administrador"),true);
 assert.equal(canEditGlobalProfile(context,{...basic,usedOtherClient:true}),false);
 assert.equal(canEditGlobalProfile(context,{...basic,usedOtherClient:false}),true);
});
test("Un gestor nunca concede más módulos, operaciones o páginas que los suyos",()=>{
 assert.equal(profileWithinManagerScope(context,basic),true);
 assert.equal(profileWithinManagerScope(context,{...basic,modules:null}),false);
 assert.equal(profileWithinManagerScope(context,{...basic,sections:null}),false);
 assert.equal(profileWithinManagerScope(context,{...basic,modules:["promociones","compras"]}),false);
 assert.equal(profileWithinManagerScope(context,{...basic,sections:["compras-preparador"]}),false);
 assert.equal(profileWithinManagerScope(context,{...basic,permissions:{promociones:["ver","crear"]}}),false);
 assert.equal(profileWithinManagerScope({...context,role:"superadministrador"},{...basic,modules:null,sections:null}),true);
});

test("permite guardar otros cambios conservando módulos deshabilitados sin conceder nuevos",()=>{
 const original={...basic,modules:["promociones","compras"],
  sections:["promociones","seguimiento-global","compras-preparador"],
  permissions:{promociones:["ver","exportar"],compras:["ver"]}};
 const renamed={...original,name:"Perfil revisado"};
 assert.equal(profileWithinManagerScope(context,renamed,original),true,
  "el módulo deshabilitado existente no impide cambiar otro ajuste");
 assert.equal(profileWithinManagerScope(context,{
  ...renamed,permissions:{...original.permissions,compras:["ver","editar"]}
 },original),false,"un módulo deshabilitado no recibe nuevas operaciones");
 assert.equal(profileWithinManagerScope(context,{
  ...renamed,sections:[...renamed.sections,"compras-recepciones"]
 },original),false,"no se añaden pantallas nuevas al módulo deshabilitado");
 const justPromotions={...basic,name:"Nuevo"};
 assert.equal(profileWithinManagerScope(context,{
  ...justPromotions,modules:["promociones","compras"]},null),false,
  "un perfil nuevo no puede asignar un módulo deshabilitado");
});
