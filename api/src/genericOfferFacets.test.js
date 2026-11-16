import test from "node:test";
import assert from "node:assert/strict";
import {describeGenericOfferGroup,genericOfferFacets} from "./genericOfferFacets.js";

test("extrae dosis, forma y envase desde la presentación DCPF oficial",()=>{
 const p=describeGenericOfferGroup({dcpf:"10001",name:"Paracetamol 500 mg comprimidos, envase de 20 comprimidos",principle:"PARACETAMOL"});
 const q=describeGenericOfferGroup({dcpf:"10002",name:"Paracetamol 1 g cápsulas, 40 cápsulas",principle:"PARACETAMOL"});
 assert.equal(p.strength,"500 mg");
 assert.equal(p.form,"Comprimidos");
 assert.equal(p.pack,"20 comprimidos");
 assert.equal(q.strength,"1 g");
 assert.equal(q.form,"Cápsulas");
 assert.equal(q.pack,"40 capsulas");
 const f=genericOfferFacets([p,q]);
 assert.deepEqual(f.strengths,["1 g","500 mg"]);
 assert.deepEqual(f.principles,["PARACETAMOL"]);
});

test("una descripción sin dosis conocida no crea una equivalencia ficticia",()=>{
 const p=describeGenericOfferGroup({name:"Medicamento sin información adicional",principle:""});
 assert.equal(p.strength,"");
 assert.equal(p.form,"");
 assert.equal(p.pack,"");
});

test("una solución inyectable no se etiqueta como solución oral",()=>{
 const injectable=describeGenericOfferGroup({name:"Paracetamol 10 mg/ml solución inyectable en vial",principle:"PARACETAMOL"});
 const oral=describeGenericOfferGroup({name:"Paracetamol 10 mg/ml solución oral en frasco de 150 ml",principle:"PARACETAMOL"});
 assert.equal(injectable.form,"Inyectable");
 assert.equal(oral.form,"Solución oral");
 assert.equal(oral.pack,"150 ml");
});
