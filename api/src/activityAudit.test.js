import test from "node:test";
import assert from "node:assert/strict";
import {auditCanRead,browserAuditEvent,documentAuditAction,classifyAuditRequest,recordAudit} from "./activityAudit.js";
test("audit only available to administrators of non-demo tenant",()=>{
 for(const role of ["gestor","farmacia","colaborador"])assert.equal(auditCanRead({role,client:{demo:false}}),false);
 assert.equal(auditCanRead({role:"administrador",client:{demo:false}}),true);
 assert.equal(auditCanRead({role:"superadministrador",client:{demo:true}}),false);
});
test("browser cannot forge server download, identity, source or risk",()=>{
 assert.equal(browserAuditEvent({action:"tariff_download",section:"proveedores"}),null);
 assert.equal(browserAuditEvent({action:"page",section:"unknown"}),null);
 const e=browserAuditEvent({action:"export_requested",section:"ventas",actor:"otro",source:"server",records:42});
 assert.equal(e.source,"browser");assert.equal(e.records,42);assert.equal(e.actor,undefined);
});
test("tariff category and selected mutation policy",()=>{
 assert.equal(documentAuditAction("Tarifas 2026"),"tariff_download");
 assert.equal(documentAuditAction("Condiciones comerciales"),"document_download");
 assert.equal(classifyAuditRequest("POST","/api/ventas/detalle",200),null);
 assert.equal(classifyAuditRequest("GET","/api/analytics/ventas/totales",200),null);
 assert.equal(classifyAuditRequest("DELETE","/api/tenant/promociones/3",200).action,"mutation");
 assert.equal(classifyAuditRequest("GET","/api/tenant/proveedores-unificados/1/ficha",403).action,"denied");
});
test("trusted identity and tenant exclusively from context; demos do not log",async()=>{
 const calls=[],pool={query:async(...a)=>calls.push(a)};
 const req={context:{client:{slug:"grupo"},role:"gestor"},user:{email:"user@example.test"}};
 await recordAudit(pool,req,{action:"page",section:"ventas",actor:"otro",source:"browser"});
 assert.deepEqual(calls[0][1].slice(0,3),["grupo","user@example.test","gestor"]);
 req.context.client.demo=true;
 await recordAudit(pool,req,{action:"page",section:"ventas"});
 assert.equal(calls.length,1);
});
