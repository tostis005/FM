import test from "node:test";
import assert from "node:assert/strict";
import {userRoleLabel,userRoleAndProfileLabel} from "./userRoleLabel.js";

test("muestra rol real del cliente en vez de Usuario autorizado",()=>{
 assert.equal(userRoleLabel({role:"usuario"},{role:"gestor"}),"Gestor");
 assert.equal(userRoleLabel({role:"usuario"},{role:"administrador"}),"Administrador");
 assert.equal(userRoleLabel({role:"usuario"},{role:"farmacia"}),"Personal de farmacia");
 assert.equal(userRoleLabel({role:"usuario"},{role:"colaborador"}),"Colaborador");
});
test("respeta superadministrador y presenta un perfil adicional cuando difiere",()=>{
 const user={role:"superadministrador"};
 assert.equal(userRoleLabel(user,{role:"gestor"}),"Superadministrador");
 assert.equal(userRoleAndProfileLabel({role:"usuario"},{role:"gestor",profile:{name:"Gestor de farmacias"}}),"Gestor");
 assert.equal(userRoleAndProfileLabel({role:"usuario"},{role:"gestor",profile:{name:"Compras y stock"}}),"Gestor · Compras y stock");
});
