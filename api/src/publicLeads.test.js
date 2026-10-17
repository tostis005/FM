import {test} from "node:test";
import assert from "node:assert/strict";
import {normalizeDemoRequest,createDemoLimiter} from "./publicLeads.js";
const good={nombre:"Farmacia Demo",email:"contacto@ejemplo.es",telefono:"+34 600 000 000",pais:"España",farmacias:"2-5",programa:"farmatic",interes:"vision_global",mensaje:"Quiero saber más",origen:"landing",consentimiento:true};
test("datos válidos y normalizados",()=>{const v=normalizeDemoRequest({...good,email:"  CONTACTO@EJEMPLO.ES "});assert.equal(v.mail,"contacto@ejemplo.es");assert.equal(v.count,"2-5");});
test("aceptación explícita obligatoria",()=>{assert.throws(()=>normalizeDemoRequest({...good,consentimiento:false}),/Revisa/);});
test("rechaza campos arbitrarios fuera de catálogo",()=>{assert.throws(()=>normalizeDemoRequest({...good,programa:"fantasia"}),/Revisa/);});
test("limita caracteres, cabeceras y errores",()=>{assert.throws(()=>normalizeDemoRequest({...good,nombre:"x".repeat(121)}));assert.throws(()=>normalizeDemoRequest({...good,email:"a@b.com\r\ncc:evil@b.com"}));});
test("límite por IP y correo, con reinicio por ventana",()=>{let t=0;const limited=createDemoLimiter(()=>t);assert.equal(limited("1.2.3.4","a@b.com"),false);assert.equal(limited("1.2.3.4","a@b.com"),false);assert.equal(limited("1.2.3.4","a@b.com"),true);t+=3600000;assert.equal(limited("1.2.3.4","a@b.com"),false);});
