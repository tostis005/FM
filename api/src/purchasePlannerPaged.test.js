import test from "node:test";
import assert from "node:assert/strict";
import {inferGenericGroupName} from "./purchasePlannerPaged.js";

test("El conjunto genérico muestra principio activo y dosis comunes, no marca comercial",()=>{
 const label=inferGenericGroupName([
  "PARACETAMOL TEVAGEN 1000 MG COMPRIMIDOS EFG 40 comprimidos",
  "PARACETAMOL CINFA 1000 MG COMPRIMIDOS EFG 20 comprimidos",
  "PARACETAMOL NORMON 1000 MG COMPRIMIDOS EFG 40 comprimidos"
 ],"17531000140106");
 assert.match(label,/PARACETAMOL.*1000.*MG/i);
 assert.doesNotMatch(label,/TEVAGEN|CINFA|NORMON/i);
 assert.match(inferGenericGroupName(["OMEPRAZOL CINFA 20 MG","OMEPRAZOL DAVUR 20 MG"],"9"),/OMEPRAZOL.*20.*MG/i);
 assert.match(inferGenericGroupName(["MARCA A"],"7"),/Genérico.*MARCA A/i);
});

test("Nomenclátor: dosis equivalente 1 g y 1000 mg y forma de comprimidos",()=>{
 const name=inferGenericGroupName([
  "CALTHEK FORTE 1 G COMPRIMIDOS, 40 comprimidos",
  "PARACETAMOL CINFA 1000 MG COMPRIMIDOS EFG 20 comprimidos",
  "PARACETAMOL NORMON 1 G COMPRIMIDOS EFG 40 comprimidos",
  "PARACETAMOL TEVAGEN 1000 MG COMPRIMIDOS EFG 40 comprimidos"
 ],"17531000140106");
 assert.match(name,/Paracetamol/i);
 assert.match(name,/1000 mg/i);
 assert.match(name,/comprimidos/i);
 assert.doesNotMatch(name,/CALTHEK|CINFA|TEVAGEN|17531000140106/i);
});
