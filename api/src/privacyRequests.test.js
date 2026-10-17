import {test} from "node:test";
import assert from "node:assert/strict";
import {validatePrivacyRequest} from "./privacyRequests.js";
const valid={nombre:"María García",email:"MARIA@EJEMPLO.ES",tipo:"acceso",detalle:"Quiero acceder a mis datos"};
test("solicitud de privacidad válida",()=>{const v=validatePrivacyRequest(valid);assert.equal(v.email,"maria@ejemplo.es");assert.equal(v.tipo,"acceso")});
test("limita el tipo de derecho",()=>assert.throws(()=>validatePrivacyRequest({...valid,tipo:"spam"})));
test("limita longitud y rechaza email con cabeceras",()=>{assert.throws(()=>validatePrivacyRequest({...valid,detalle:"X".repeat(1501)}));assert.throws(()=>validatePrivacyRequest({...valid,email:"aa@bb.es\r\nCc:someone@example.com"}))});
