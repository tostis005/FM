import test from "node:test";
import assert from "node:assert/strict";
import {USER_SECTIONS,effectiveUserSections,validateSectionGrants,requestSections} from "./userSectionAccess.js";

const modules={ventas:true,compras:true,stock:false,promociones:true};
test("secciones heredadas mantienen el acceso hasta configurarlas",()=>{
 const legacy=effectiveUserSections(modules,null);
 assert.equal(legacy.ventas,true);
 assert.equal(legacy["ventas-tickets"],true);
 assert.equal(legacy["compras-preparador"],true);
 assert.equal(legacy["stock-historico"],false);
});
test("un permiso por pantalla no concede automáticamente sus hermanas",()=>{
 const scoped=effectiveUserSections(modules,["ventas-tickets","compras-preparador"]);
 assert.equal(scoped.ventas,false);
 assert.equal(scoped["ventas-tickets"],true);
 assert.equal(scoped["ventas-devoluciones"],false);
 assert.equal(scoped.compras,false);
 assert.equal(scoped["compras-preparador"],true);
 assert.equal(scoped["stock-historico"],false);
});
test("validación impide rutas ajenas, deshabilitadas y duplicadas",()=>{
 assert.deepEqual(validateSectionGrants(["ventas-tickets","compras-preparador"],modules),["ventas-tickets","compras-preparador"]);
 assert.deepEqual(validateSectionGrants([],modules),[]);
 assert.equal(validateSectionGrants(["stock"],modules),null);
 assert.equal(validateSectionGrants(["usuarios"],modules),null);
 assert.equal(validateSectionGrants(["ventas","ventas"],modules),null);
 assert.equal(validateSectionGrants("ventas",modules),null);
});
test("todas las rutas tienen claves únicas y se exige la ruta documental exacta",()=>{
 assert.equal(new Set(USER_SECTIONS.map(s=>s.id)).size,USER_SECTIONS.length);
 const mock=path=>requestSections({path});
 assert.deepEqual(mock("/api/analytics/pantallas/ventas-tickets/lineas"),["ventas-tickets"]);
 assert.deepEqual(mock("/api/analytics/pantallas/compras-recepciones"),["compras-recepciones"]);
 assert.deepEqual(mock("/api/analytics/stock/sin-recepciones"),["stock-sin-recepciones"]);
 assert.deepEqual(mock("/api/analytics/ventas/resumen"),[]);
});
