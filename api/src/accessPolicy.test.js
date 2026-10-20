import test from "node:test";
import assert from "node:assert/strict";
import {validClientDomain,validInternalEmail,googleDomainAuthorized,googleMembershipAuthorized} from "./accessPolicy.js";
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

test("Gmail personal sólo es válido cuando se ha invitado y está activo",()=>{
 const person={active:true,login_method:"google",individually_invited:true,domain_allowed:false};
 assert.equal(googleMembershipAuthorized(person),true);
 assert.equal(googleMembershipAuthorized({...person,individually_invited:false}),false);
 assert.equal(googleMembershipAuthorized({...person,active:false}),false);
 assert.equal(googleMembershipAuthorized({...person,login_method:"local"}),false);
});

test("los accesos Workspace automáticos se revocan cuando se desautoriza su dominio",()=>{
 const user={active:true,login_method:"google",individually_invited:false,domain_allowed:true};
 assert.equal(googleMembershipAuthorized(user),true);
 assert.equal(googleMembershipAuthorized({...user,domain_allowed:false}),false);
 // Una invitación individual sigue siendo válida aunque no dependa de Workspace.
 assert.equal(googleMembershipAuthorized({...user,domain_allowed:false,individually_invited:true}),true);
});
