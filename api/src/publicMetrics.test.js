import {test} from "node:test";
import assert from "node:assert/strict";
import {normalizePageview,createViewLimiter} from "./publicMetrics.js";
test("acepta rutas públicas estrictas",()=>{
 for(const ruta of ["/","/solicitar-demo/","/soluciones/stock-farmacia/","/integraciones/farmatic/","/blog/kpis-gestion-farmacia/"])
   assert.equal(normalizePageview({tipo:"vista",ruta}),ruta);
});
test("rechaza rutas privadas, parámetros y rutas sensibles",()=>{
 for(const ruta of ["/dashboard","/login","/privacidad/solicitud/","/blog/cosa?q=abc","https://otro.com/","/../../tmp","/api/admin/privacidad"])
   assert.equal(normalizePageview({tipo:"vista",ruta}),null);
});
test("rechaza eventos que no sean visitas",()=>assert.equal(normalizePageview({tipo:"clic",ruta:"/"}),null));
test("limitador rechaza saturación sin persistir IP",()=>{
 let t=0;const limit=createViewLimiter(()=>t);
 for(let i=0;i<30;i++)assert.equal(limit("test"),true);
 assert.equal(limit("test"),false);t+=60000;assert.equal(limit("test"),true);
});
