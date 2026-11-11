import test from "node:test";
import assert from "node:assert/strict";
import {normalizeClientAppearance,clientAppearanceStyle,isCustomAppearance,contrastText} from "./tenantAppearance.js";

test("otras empresas conservan el tema existente",()=>{
 assert.equal(isCustomAppearance(null),false);
 assert.equal(normalizeClientAppearance(null).menuMode,"claro");
});
test("Ampedia recibe marca personalizada y tokens accesibles",()=>{
 const a={brandName:"Farmacia Abadía",logoUrl:"https://farmaciaabadia.com/favicon.ico",primaryColor:"#087f79",secondaryColor:"#145853",menuMode:"claro"};
 assert.equal(isCustomAppearance(a),true);
 assert.equal(clientAppearanceStyle(a)["--fm-brand-primary"],"#087F79");
 assert.equal(contrastText("#145853"),"#FFFFFF");
 assert.equal(contrastText("#F8FAFA"),"#142C2A");
});
