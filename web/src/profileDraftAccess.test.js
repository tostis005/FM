import test from "node:test";
import assert from "node:assert/strict";
import {normalizeExplicitModuleViews,withModuleView,withAuditAccess} from "./profileDraftAccess.js";

test("activar un módulo con permisos vacíos siempre concede Ver",()=>{
 assert.deepEqual(withModuleView({ventas:[]},"ventas"),{ventas:["ver"]});
 assert.deepEqual(withModuleView({ventas:["editar"]},"ventas"),{ventas:["ver","editar"]});
 assert.deepEqual(withModuleView({ventas:["ver","exportar"]},"ventas"),{ventas:["ver","exportar"]});
});

test("guardar Ventas y Ventas (resumen) repara perfiles configurados antes de la corrección",()=>{
 const draft={name:"Gestor",baseRole:"gestor",
  modules:["ventas"],sections:["ventas"],permissions:{ventas:[]}};
 const fixed=normalizeExplicitModuleViews(draft);
 assert.deepEqual(fixed.permissions.ventas,["ver"]);
 assert.deepEqual(fixed.modules,["ventas"]);
 assert.deepEqual(fixed.sections,["ventas"]);
 assert.deepEqual(draft.permissions.ventas,[],"no modifica el estado de entrada");
});

test("no concede lectura de otros módulos ni modifica perfiles con herencia global",()=>{
 const draft={modules:["ventas"],sections:["ventas"],
  permissions:{ventas:[],compras:[],promociones:["editar"]}};
 const fixed=normalizeExplicitModuleViews(draft);
 assert.deepEqual(fixed.permissions,{ventas:["ver"],compras:[],promociones:["editar"]});
 const inherited={modules:null,sections:null,permissions:{ventas:[]}};
 assert.equal(normalizeExplicitModuleViews(inherited),inherited);
});

test("permisos de un módulo deshabilitado no cambian al guardar otro",()=>{
 const draft={modules:["ventas","compras"],sections:["ventas","compras-preparador"],
  permissions:{ventas:[],compras:[]}};
 const fixed=normalizeExplicitModuleViews(draft,["ventas"]);
 assert.deepEqual(fixed.permissions,{ventas:["ver"],compras:[]});
 assert.deepEqual(fixed.modules,draft.modules);
 assert.deepEqual(fixed.sections,draft.sections);
});

test("Auditoría no se concede por normalización; el interruptor es explícito y reversible",()=>{
 const inherited={modules:null,sections:null,permissions:{}};
 const explicit={modules:["ventas","auditoria"],sections:["ventas"],permissions:{ventas:["ver"]}};
 assert.equal(normalizeExplicitModuleViews(explicit).permissions.auditoria,undefined);
 assert.deepEqual(withAuditAccess(inherited,true).permissions.auditoria,["ver"]);
 assert.deepEqual(withAuditAccess(withAuditAccess(inherited,true),false).permissions.auditoria,[]);
 assert.deepEqual(withAuditAccess(explicit,true).sections,["ventas","auditoria"]);
 assert.deepEqual(withAuditAccess(withAuditAccess(explicit,true),false).modules,["ventas"]);
});
