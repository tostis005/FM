import test from "node:test";
import assert from "node:assert/strict";
import {genericDraftLaboratoryKey} from "./genericDraftLaboratory.js";

test("si el laboratorio tiene proveedor directo de nombre único lo resuelve automáticamente",()=>{
 const suppliers=[{id:"51",name:"LABORATORIOS NORMON S.A."},
  {id:"52",name:"LABORATORIOS CINFA"}];
 assert.equal(genericDraftLaboratoryKey("NORMON",suppliers,[]),"P:51");
 assert.equal(genericDraftLaboratoryKey("CINFA",suppliers,[]),"P:52");
});
test("sin proveedor inequívoco el borrador sigue siendo del laboratorio, nunca de otro proveedor",()=>{
 assert.equal(genericDraftLaboratoryKey("NORMON",[]),"N:NORMON");
 assert.equal(genericDraftLaboratoryKey("NORMON",[{id:"50",name:"NORMON"},
  {id:"51",name:"LABORATORIOS NORMON"}]),"N:NORMON");
 assert.equal(genericDraftLaboratoryKey("NORMON",
  [{id:"51",name:"NORMON"}],[{laboratory:"NORMON",supplierId:"85"}]),"P:85");
 assert.throws(()=>genericDraftLaboratoryKey(""),/inválido/);
});
