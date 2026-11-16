import test from "node:test";
import assert from "node:assert/strict";
import {availablePharmacies,hasSinglePharmacy,isPharmacyColumn} from "./pharmacyPresentation.js";
test("solo se simplifica si hay exactamente una farmacia autorizada y operativa",()=>{
 assert.equal(hasSinglePharmacy([]),false);
 assert.equal(hasSinglePharmacy([{id:1,name:"Única"}]),true);
 assert.equal(hasSinglePharmacy([{id:1},{id:2}]),false);
 assert.equal(hasSinglePharmacy([{id:1},{id:2,active:false}]),true);
 assert.equal(hasSinglePharmacy([{id:1},{id:3,establishmentType:"almacen"}]),true);
 assert.equal(hasSinglePharmacy([{id:3,establishmentType:"almacen"}]),false);
 assert.equal(availablePharmacies([{id:1},{id:2,active:false}]).length,1);
});
test("oculta sólo columnas de farmacia, nunca almacenes, orígenes ni nombres de la ficha",()=>{
 assert.equal(isPharmacyColumn({key:"pharmacy",label:"Farmacia"}),true);
 assert.equal(isPharmacyColumn({key:"pharmacyName",label:"Farmacia"}),true);
 assert.equal(isPharmacyColumn("Farmacia"),true);
 assert.equal(isPharmacyColumn("Farmacias"),true);
 assert.equal(isPharmacyColumn({key:"name",label:"Nombre público"}),false);
 assert.equal(isPharmacyColumn({key:"originName",label:"Establecimiento"}),false);
 assert.equal(isPharmacyColumn({key:"destinationName",label:"Origen / destino"}),false);
 assert.equal(isPharmacyColumn({key:"pharmacyId",label:"Identificador"}),false);
});
