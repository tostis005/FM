import test from "node:test";
import assert from "node:assert/strict";
import {parseGenericOfferSheets} from "./genericOffersImport.js";
import {allocateGenericUnits,distributeGenericUnits,sumGenericPharmacies} from "./genericOfferPlanning.js";

test("las cabeceras de todos los laboratorios conservan el CN y el PUC ofertado",()=>{
 const result=parseGenericOfferSheets({
  CINFA:[["Código","Artículo","Pvl","%Dto","Neto","Iva","Puc","U. Min","U. Pack","U. caja"],
   [659407,"#NAME?",6.4,.65,2.24,.04,2.3296,1,6,48]],
  SANDOZ:[["Código","Artículo","Pvl","%Dto","Neto","Iva","Puc"],
   [663922,"Alprazolam Sandoz 0,25 mg",1.05,.65,.3675,.04,.3822]]
 });
 assert.equal(result.items.length,2);
 assert.equal(result.items[0].cn,"659407");
 assert.equal(result.items[0].name,"");
 assert.equal(result.items[0].minimum,1);
 assert.equal(result.items[0].pack,6);
 assert.equal(result.items[1].puc,.3822);
});
test("el Excel con códigos o precios inválidos no se carga parcialmente",()=>{
 assert.throws(()=>parseGenericOfferSheets({CINFA:[
  ["Código","Artículo","Pvl","%Dto","Neto","Iva","Puc"],
  ["error","",1,.5,.5,.04,.52]
 ]}),/No hay ofertas válidas/);
});
test("cuotas parciales dejan intacto el porcentaje no asignado",()=>{
 assert.deepEqual(allocateGenericUnits(100,[{percent:20},{percent:15}]),
  {units:[20,15],percentage:35,unassigned:65});
 assert.deepEqual(allocateGenericUnits(3,[{percent:50},{percent:50}]).units,[2,1]);
 assert.throws(()=>allocateGenericUnits(100,[{percent:80},{percent:40}]),/superan/);
});
test("reparto uniforme por farmacias mantiene el total y admite revisión",()=>{
 const result=distributeGenericUnits(11,[{id:4},{id:2},{id:3}]);
 assert.deepEqual(result,{"4":4,"2":4,"3":3});
 assert.equal(sumGenericPharmacies(result),11);
});
