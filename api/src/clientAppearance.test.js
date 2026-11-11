import test from "node:test";
import assert from "node:assert/strict";
import {appearanceFromDatabase,normalizeAppearance,validateAppearance} from "./clientAppearance.js";

test("los clientes sin apariencia conservan los colores por defecto",()=>{
 assert.equal(normalizeAppearance().menuMode,"claro");
 assert.equal(normalizeAppearance().logoUrl,"");
});
test("mapea las columnas de PostgreSQL al contrato de interfaz",()=>{
 assert.deepEqual(appearanceFromDatabase({nombre_marca:"Farmacia Abadía",color_primario:"#087f79",color_secundario:"#145853",estilo_menu:"oscuro"}),{
  brandName:"Farmacia Abadía",logoUrl:"",primaryColor:"#087F79",secondaryColor:"#145853",menuMode:"oscuro"
 });
});
test("rechaza esquemas inseguros para los logos",()=>{
 const base={brandName:"Farmacia",logoUrl:"javascript:alert(1)",primaryColor:"#087F79",secondaryColor:"#145853",menuMode:"claro"};
 assert.ok(validateAppearance(base).error);
 assert.ok(validateAppearance({...base,logoUrl:"data:image/svg+xml;base64,PHN2Zz4="}).error);
 assert.ok(validateAppearance({...base,logoUrl:"http://example.com/logo.png"}).error);
 assert.ok(validateAppearance({...base,logoUrl:"https://example.com/logo.png"}).appearance);
});
test("la actualización no acepta propiedades no autorizadas",()=>{
 const payload={brandName:"A",logoUrl:"",primaryColor:"#087F79",secondaryColor:"#145853",menuMode:"claro",slug:"otro"};
 assert.ok(validateAppearance(payload).error);
});
