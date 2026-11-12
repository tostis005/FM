import test from "node:test";
import assert from "node:assert/strict";
import {normalizeExplicitModuleViews,withModuleView} from "./profileDraftAccess.js";

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
