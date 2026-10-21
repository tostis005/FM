import test from "node:test";
import assert from "node:assert/strict";
import {inferGenericGroupName} from "./purchasePlannerPaged.js";

test("El conjunto genérico muestra principio activo y dosis comunes, no marca comercial",()=>{
 const label=inferGenericGroupName([
  "PARACETAMOL TEVAGEN 1000 MG COMPRIMIDOS EFG 40 comprimidos",
  "PARACETAMOL CINFA 1000 MG COMPRIMIDOS EFG 20 comprimidos",
  "PARACETAMOL NORMON 1000 MG COMPRIMIDOS EFG 40 comprimidos"
 ],"17531000140106");
 assert.match(label,/PARACETAMOL.*1000.*MG/);
 assert.doesNotMatch(label,/TEVAGEN|CINFA|NORMON/);
 assert.match(inferGenericGroupName(["OMEPRAZOL CINFA 20 MG","OMEPRAZOL DAVUR 20 MG"],"9"),/OMEPRAZOL.*20.*MG/);
 assert.match(inferGenericGroupName(["MARCA A"],"7"),/Genérico.*7/);
});
