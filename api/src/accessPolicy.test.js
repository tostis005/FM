import test from "node:test";
import assert from "node:assert/strict";
import {validClientDomain,validInternalEmail,googleDomainAuthorized} from "./accessPolicy.js";
test("dominios corporativos validados sin correos públicos ni coincidencias parciales",()=>{
 assert.equal(validClientDomain("farmacia.es"),true);
 assert.equal(validClientDomain("sub.grupo-farma.es"),true);
 for(const domain of ["gmail.com","hotmail.com","evil.com/","@bad@domain.es",
   "farmacia.es.attacker.tld;",".es","invalid"])
  assert.equal(validClientDomain(domain),false,domain);
});
test("alta interna limitada al dominio exacto asignado al cliente",()=>{
 assert.equal(validInternalEmail("Ana@Farmacia.ES",["farmacia.es"]),true);
 assert.equal(validInternalEmail("ana@farmacia.es.evil.com",["farmacia.es"]),false);
 assert.equal(validInternalEmail("ana@gmail.com",["farmacia.es"]),false);
 assert.equal(validInternalEmail("ana@otra.es",["farmacia.es"]),false);
});
test("SSO exige Google Workspace hd coincidente, además de correo verificado",()=>{
 assert.equal(googleDomainAuthorized("ana@farmacia.es","farmacia.es","farmacia.es"),true);
 assert.equal(googleDomainAuthorized("ana@farmacia.es","","farmacia.es"),false);
 assert.equal(googleDomainAuthorized("ana@farmacia.es","farmacia.es.evil.com","farmacia.es"),false);
 assert.equal(googleDomainAuthorized("ana@gmail.com","gmail.com","gmail.com"),false);
});
