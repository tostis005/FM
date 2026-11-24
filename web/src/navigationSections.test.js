import test from "node:test";
import assert from "node:assert/strict";
import {NAVIGATION_GROUPS,groupForPage,availableGroups,availableTabs,defaultGroupPage,navigationUrl,settingsPageFromSearch,canonicalTab,PROFIT_VIEWS,WORK_VIEWS} from "./navigationSections.js";
test("each page belongs to exactly one top-level module; ventas is flat",()=>{
 const ids=NAVIGATION_GROUPS.flatMap(g=>g.tabs.map(([id])=>id));
 assert.equal(new Set(ids).size,ids.length);
 assert.deepEqual(groupForPage("ventas-laboratorios").tabs.map(([id])=>id),["ventas","ventas-tickets","ventas-devoluciones","ventas-laboratorios"]);
 assert.equal(groupForPage("stock-inmovilizado").id,"stock");
 assert.equal(groupForPage("alertas-inteligentes").id,"acciones");
 assert.equal(groupForPage("seguimiento-global").id,"promociones");
 assert.equal(groupForPage("oportunidades-seguimiento").id,"acciones");
 assert.equal(canonicalTab("oportunidades-seguimiento"),"acciones");
});
test("a child-only profile sees its module and first permitted tab, not forbidden summary",()=>{
 const allowed=id=>["compras-preparador","seguimiento-global","usuarios"].includes(id);
 assert.deepEqual(availableGroups(allowed).map(g=>g.id),["compras","promociones","configuracion"]);
 assert.deepEqual(availableTabs(groupForPage("compras"),allowed).map(([id])=>id),["compras-preparador"]);
 assert.equal(defaultGroupPage(groupForPage("compras"),allowed),"compras-preparador");
 assert.equal(defaultGroupPage(groupForPage("ventas"),allowed),null);
});
test("existing settings and promotion links retain URL compatibility",()=>{
 assert.equal(navigationUrl("seguimiento-global"),"/promociones/seguimiento");
 assert.equal(navigationUrl("promociones-objetivos"),"/promociones/nueva");
 assert.equal(navigationUrl("ajustes-picking-list"),"/ajustes?seccion=picking-list");
 assert.equal(settingsPageFromSearch("?seccion=picking-list"),"ajustes-picking-list");
 assert.equal(settingsPageFromSearch("?seccion=invalid"),"ajustes");
 assert.equal(PROFIT_VIEWS["rentabilidad-detalle-ventas"],"ventas");
 assert.equal(WORK_VIEWS["rentabilidad-retorno"],"rentabilidad-retorno");
});
