import test from "node:test";
import assert from "node:assert/strict";
import {groupLaboratoriesByMaster} from "./laboratoryMasterGrouping.js";

test("un laboratorio configurado con dos nombres aparece una sola vez con ambas fuentes",()=>{
 const evidence=[
  {key:"N:CINFA",name:"CINFA",hasMedication:true,hasParapharmacy:false},
  {key:"N:THINFILE",name:"THINFILE",hasMedication:false,hasParapharmacy:true},
  {key:"N:LABORATORIOS CINFA",name:"Laboratorios Cinfa, S.A.",hasMedication:false,hasParapharmacy:true}
 ];
 const master=[
  {name:"THINFILE",laboratoryKey:"N:CINFA",cooperative:false,ignoreReports:false},
  {name:"LABORATORIOS CINFA SA",laboratoryKey:"N:CINFA",cooperative:false,ignoreReports:false}
 ];
 const result=groupLaboratoriesByMaster(evidence,master);
 assert.equal(result.length,1);
 assert.equal(result[0].key,"N:CINFA");
 assert.equal(result[0].name,"CINFA");
 assert.equal(result[0].hasMedication,true);
 assert.equal(result[0].hasParapharmacy,true);
});

test("no mostrar cooperativas ni proveedores ignorados aunque tengan CN AEMPS",()=>{
 const source=[
  {key:"N:OCULTA",name:"LABORATORIOS OCULTA SA",hasMedication:true},
  {key:"N:COOP",name:"COOP",hasParapharmacy:true},
  {key:"N:CINFA",name:"CINFA",hasMedication:true}
 ];
 const master=[
  {name:"OCULTA",ignoreReports:true},
  {name:"COOP",cooperative:true},
  {name:"CINFA",laboratoryKey:"N:CINFA"}
 ];
 assert.deepEqual(groupLaboratoriesByMaster(source,master).map(x=>x.key),["N:CINFA"]);
});

test("no mezclar manualmente fabricantes diferentes ni ocultar un grupo con proveedor visible",()=>{
 const source=[
  {key:"N:ALFA",name:"ALFA",hasMedication:true},
  {key:"N:ALFA DIST",name:"ALFA DIST",hasParapharmacy:true},
  {key:"N:BETA",name:"BETA",hasMedication:true}
 ];
 const master=[
  {name:"ALFA DIST",laboratoryKey:"N:ALFA",ignoreReports:true},
  {name:"ALFA",laboratoryKey:"N:ALFA"},
  {name:"BETA",laboratoryKey:"N:BETA"}
 ];
 assert.deepEqual(groupLaboratoriesByMaster(source,master).map(x=>x.key),["N:ALFA","N:BETA"]);
});

test("nombres iguales con destinos manuales contradictorios no se fusionan arbitrariamente",()=>{
 const source=[{key:"N:NOMBRE ERP",name:"Nombre ERP",hasParapharmacy:true}];
 const master=[
  {name:"Nombre ERP",laboratoryKey:"N:LABORATORIO A"},
  {name:"Nombre ERP",laboratoryKey:"N:LABORATORIO B"}
 ];
 const result=groupLaboratoriesByMaster(source,master);
 assert.deepEqual(result.map(x=>x.key),["N:NOMBRE ERP"]);
});

test("denominación real de Farmatic CINFA LABORATORIOS S A CINFA se integra con CINFA",()=>{
 const evidence=[
  {key:"N:CINFA",name:"CINFA",hasMedication:true},
  {key:"N:CINFA LABORATORIOS S A CINFA",
   name:"CINFA LABORATORIOS, S.A. CINFA",hasParapharmacy:true}
 ];
 const master=[
  {name:"CINFA",laboratoryKey:"N:CINFA"},
  {name:"CINFA LABORATORIOS, S.A.",laboratoryKey:"N:CINFA"}
 ];
 const rows=groupLaboratoriesByMaster(evidence,master);
 assert.equal(rows.length,1);
 assert.equal(rows[0].key,"N:CINFA");
 assert.equal(rows[0].hasMedication,true);
 assert.equal(rows[0].hasParapharmacy,true);
});
