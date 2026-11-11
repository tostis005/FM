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
 assert.deepEqual(mock("/api/tenant/proveedores/traspasos-salidas"),["stock-traspasos"]);
 assert.deepEqual(mock("/api/analytics/pedidos/propuesta"),["compras-preparador","compras-pendientes","compras-pedidos"]);
 assert.deepEqual(mock("/api/analytics/ventas/resumen"),[]);
});

test("Proveedores sigue exactamente los módulos y secciones asignados",()=>{
 const restricted=effectiveUserSections({proveedores:false,ventas:true},[]);
 assert.equal(restricted.proveedores,false);
 assert.equal(restricted["proveedores-condiciones"],false);
 assert.equal(restricted.ventas,false);
 const partial=effectiveUserSections({proveedores:true},["proveedores-condiciones"]);
 assert.equal(partial.proveedores,false);
 assert.equal(partial["proveedores-condiciones"],true);
 const directoryOnly=effectiveUserSections({proveedores:true},["proveedores"]);
 assert.equal(directoryOnly.proveedores,true);
 assert.equal(directoryOnly["proveedores-condiciones"],false);
 const noAnalysis=effectiveUserSections({proveedores:true},[]);
 assert.equal(noAnalysis.proveedores,false);
 assert.equal(noAnalysis["proveedores-condiciones"],false);
 const legacy=effectiveUserSections({proveedores:true},null);
 assert.equal(legacy.proveedores,true);
 assert.deepEqual(requestSections({path:"/api/tenant/proveedores-unificados/17/ficha"}),["proveedores"]);
 assert.deepEqual(requestSections({path:"/api/tenant/proveedor-documento-categorias"}),["proveedores"]);
});

test("el catálogo de perfiles muestra solo rutas operativas y conserva las históricas",()=>{
 const visible=USER_SECTIONS.filter(s=>s.profileVisible).map(s=>s.id);
 assert.deepEqual(visible,[
  "dashboard","ventas","compras","compras-preparador","stock",
  "stock-sin-recepciones","picking-list","proveedores","genericos",
  "rentabilidad-retorno","promociones","seguimiento-global",
  "promociones-objetivos","acciones","oportunidades-seguimiento",
  "alertas","mi-trabajo"
 ]);
 for(const obsolete of ["reposicion","informes","ventas-tickets",
  "compras-recepciones","stock-historico","proveedores-condiciones"]){
  assert.equal(USER_SECTIONS.find(s=>s.id===obsolete)?.profileVisible,false);
 }
 assert.deepEqual(validateSectionGrants(["compras-recepciones"],
  {compras:true}),["compras-recepciones"]);
 assert.equal(USER_SECTIONS.find(s=>s.id==="acciones")?.name,"Trabajo y ahorro");
 assert.equal(USER_SECTIONS.find(s=>s.id==="rentabilidad-retorno")?.name,"Ahorro verificado");
});
