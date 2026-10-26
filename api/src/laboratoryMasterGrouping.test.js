import test from "node:test";
import assert from "node:assert/strict";
import {groupLaboratoriesByMaster,exactMasterAliases} from "./laboratoryMasterGrouping.js";

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

test("un proveedor ignorado sigue oculto aunque otra ficha del maestro tenga el mismo nombre",()=>{
 const list=groupLaboratoriesByMaster([
  {key:"N:DISTRIBUIDOR Z",name:"Distribuidor Z, S.A.",hasParapharmacy:true},
  {key:"N:LABORATORIO REAL",name:"Laboratorio Real",hasMedication:true}
 ],[
  {name:"Distribuidor Z S.A.",cooperative:false,ignoreReports:true},
  {name:"Distribuidor Z S.A.",laboratoryKey:"N:DISTRIBUIDOR Z",ignoreReports:false},
  {name:"Laboratorio Real",laboratoryKey:"N:LABORATORIO REAL"}
 ]);
 assert.deepEqual(list.map(x=>x.key),["N:REAL"]);
});
test("ignorar en informes y cooperativa sin mapeo excluye razones sociales repetidas de Farmatic",()=>{
 const results=groupLaboratoriesByMaster([
  {key:"N:COOPERATIVA XYZ S A COOPERATIVA XYZ",
   name:"COOPERATIVA XYZ S.A. COOPERATIVA XYZ",hasParapharmacy:true},
  {key:"N:LABORATORIO INVISIBLE S L LABORATORIO INVISIBLE",
   name:"LABORATORIO INVISIBLE S.L. LABORATORIO INVISIBLE",hasMedication:true},
  {key:"N:PROVEEDOR REAL",name:"Proveedor Real",hasParapharmacy:true}
 ],[
  {name:"COOPERATIVA XYZ S.A.",type:"cooperativa",cooperative:false},
  {name:"Laboratorio Invisible S.L.",ignoreReports:true},
  {name:"Proveedor Real",laboratoryKey:"N:PROVEEDOR REAL"}
 ]);
 assert.deepEqual(results.map(x=>x.key),["N:PROVEEDOR REAL"]);
});
test("un proveedor oculto no debe ocultar otro origen válido del mismo laboratorio",()=>{
 const result=groupLaboratoriesByMaster([
  {key:"N:CINFA LABORATORIOS S A CINFA",name:"CINFA LABORATORIOS S.A. CINFA",
   hasMedication:true},
  {key:"N:CINFA",name:"Cinfa",hasMedication:true}
 ],[
  {name:"Cinfa Laboratorios S.A.",laboratoryKey:"N:CINFA",ignoreReports:true},
  {name:"Cinfa",laboratoryKey:"N:CINFA",ignoreReports:false}
 ]);
 assert.equal(result.length,1);
 assert.equal(result[0].key,"N:CINFA");
});

test("prefijos Farmatic 0.-, 01, 3- y notas al final no reintroducen ignorados/cooperativas",()=>{
 const master=[
  {name:"0.-AMPEDIA MERCANTIL SL",ignoreReports:true},
  {name:"01 ALLIANCE HEALTHCARE",ignoreReports:true},
  {name:"3- BIDAFARMA S.COOP.",type:"cooperativa"},
  {name:"02 BIDA FARMA S COOP AND (CECOFAR)",cooperative:true},
  {name:"001- AMPEDIA MERCANTIL SL (ALMACEN)",ignoreReports:true},
  {name:"PROVEEDOR ADMITIDO",laboratoryKey:"N:PROVEEDOR ADMITIDO"}
 ];
 const flagged=["AMPEDIA MERCANTIL","ALLIANCE HEALTHCARE",
  "BIDAFARMA","BIDA FARMA"];
 for(const [supplier,expected] of [
  [master[0],"AMPEDIA MERCANTIL"],
  [master[1],"ALLIANCE HEALTHCARE"],
  [master[2],"BIDAFARMA"],
  [master[3],"BIDA FARMA"]
 ])assert.ok(exactMasterAliases(supplier).includes(expected),
  supplier.name+" no se normaliza a "+expected);
 const result=groupLaboratoriesByMaster([
  ...flagged.map(name=>({key:"N:"+name,name,hasMedication:true})),
  {key:"N:PROVEEDOR ADMITIDO",name:"Proveedor Admitido",hasParapharmacy:true}
 ],master);
 assert.deepEqual(result.map(l=>l.key),["N:PROVEEDOR ADMITIDO"]);
});

test("nombres comerciales que empiezan por números sin separador no pierden esos dígitos",()=>{
 assert.ok(exactMasterAliases({name:"3M MEDICAL",ignoreReports:true}).includes("3M MEDICAL"));
 assert.ok(!exactMasterAliases({name:"3M MEDICAL",ignoreReports:true}).includes("M MEDICAL"));
});
