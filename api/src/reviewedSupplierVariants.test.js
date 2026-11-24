import test from "node:test";
import assert from "node:assert/strict";
import {reviewedSupplierVariants,planSupplierNameConsolidation,supplierIdentityRoot,isObsoleteSupplierName} from "./reviewedSupplierVariants.js";
test("only explicitly reviewed names with corroborating current alias evidence are eligible",()=>{
 const master=[{id:"1",name:"NOVARTS",class:"DIRECTO",active:true},{id:"2",name:"NOVARTIS",class:"DIRECTO",active:true},{id:"3",name:"ARAFARMA",class:"DIRECTO",active:true},{id:"4",name:"HRA PHARMA",class:"DIRECTO",active:true}];
 const aliases=[{supplier:"1",pharmacyCode:"ABA",sourceCode:"1"},{supplier:"2",pharmacyCode:"LUZ",sourceCode:"01"},{supplier:"3",pharmacyCode:"ABA",sourceCode:"2"},{supplier:"4",pharmacyCode:"LUZ",sourceCode:"2"}];
 assert.deepEqual(reviewedSupplierVariants(master,aliases).operations.map(o=>[o.from,o.to]),[["1","2"]]);
 assert.equal(reviewedSupplierVariants(master,aliases,new Set(["1"])).operations.length,0);
 assert.equal(reviewedSupplierVariants(master,aliases,new Set(),new Set(["2"])).operations.length,0);
 assert.equal(reviewedSupplierVariants(master,aliases.map(a=>({...a,pharmacyCode:"ABA"}))).operations.length,0);
 assert.equal(reviewedSupplierVariants(master,aliases.filter(a=>a.supplier!=="2")).operations.length,0);
});

test("nombres completos equivalentes: internos, mayoristas y servicios; se conservan categorías y orígenes protegidos",()=>{
 const master=[
  {id:"1",name:"0 AM PEDIA MERCANTIL SL",class:"INTERNO",active:true},
  {id:"2",name:"0-AMPEDIA MERCANTIL S.L.",class:"INTERNO",active:true},
  {id:"3",name:"0 AM PEDIA MERCANTIL S.L.",class:"INTERNO",active:true},
  {id:"4",name:"ALLIANCE HEALTHCARE ESPAÑA S.A.",class:"MAYORISTA",active:true},
  {id:"5",name:"ALLIANZ HEALTH CARE",class:"MAYORISTA",active:true},
  {id:"6",name:"ALLIANZ CARE",class:"OTROS",active:true},
  {id:"7",name:"ZZZ_NO_USAR_AMPEDIA MERCANTIL",class:"INTERNO",active:true},
  {id:"8",name:"AMPEDIA MERCANTIL SL",class:"INTERNO",active:true},
  {id:"9",name:"AMPEDIA MERCANTIL LOGISTICA",class:"INTERNO",active:true}
 ];
 const aliases=master.map(p=>({supplier:p.id,pharmacyCode:"ABA",sourceCode:p.id}));
 assert.equal(supplierIdentityRoot("0 Ampedia Mercantil SL"),supplierIdentityRoot("0-Ampedia Mercantil S.L."));
 assert.ok(isObsoleteSupplierName("ZZZ_NO_USAR"));
 assert.ok(isObsoleteSupplierName("zzzz - no-usar antiguo"));
 assert.equal(isObsoleteSupplierName("LAB ZETA"),false);
 const result=planSupplierNameConsolidation(master,aliases,new Set(),new Set(["8"]));
 assert.deepEqual(result.operations.map(x=>[x.from,x.to]),[["1","8"],["2","8"],["3","8"],["5","4"]]);
 assert.equal(planSupplierNameConsolidation(master,aliases,new Set(["2"]),new Set(["8"])).operations.some(x=>x.from==="2"),false);
 assert.notEqual(supplierIdentityRoot("ALLIANZ CARE"),supplierIdentityRoot("ALLIANCE HEALTHCARE"));
});

test("consolidación incluye prefijos de laboratorio y pares previamente revisados sin fusionar marcas distintas",()=>{
 const master=[{id:"1",name:"LABORATORIOS GEBRO PHARMA S.A.",class:"DIRECTO",active:true},
  {id:"2",name:"GEBRO PHARMA SA",class:"DIRECTO",active:true},
  {id:"3",name:"NOVARTS",class:"DIRECTO",active:true},{id:"4",name:"NOVARTIS",class:"DIRECTO",active:true},
  {id:"5",name:"GEBRO PHARMA VETERINARIA",class:"DIRECTO",active:true}];
 const aliases=master.map(p=>({supplier:p.id,pharmacyCode:p.id==="3"?"ABA":"NOR",sourceCode:p.id==="3"||p.id==="4"?"123":p.id}));
 const plan=planSupplierNameConsolidation(master,aliases);
 assert.deepEqual(plan.operations.map(x=>[x.from,x.to]),[["2","1"],["3","4"]]);
});

test("variantes revisadas individualmente en el maestro histórico",()=>{
 const pairs=[
  ["DOGGIO RUSTICA","DOGGIO RUSTICA DE LOS YEBENES, S.L."],
  ["GESTION OPTIMA DE FARM","GESTION OPTIMA DE FARMACIA, S.L."],
  ["SPORT LIFESTYLE","SPORT LIFESTYLE MANAGEMENT S.L."],
  ["LACIDAR SL (CLEANDS)","LACIDAR SL (CLEANS)"],
  ["B.G.P.PRODUCTS OPERATIONS, S.L.(UNI","BGP PRODUCTS OPERATIONS"],
  ["REGISTRO MERCANTIL TOLEDO CB","REGISTRO MERCANTIL TOLEDO"]
 ];
 for(const [a,b] of pairs)assert.equal(supplierIdentityRoot(a),supplierIdentityRoot(b));
 for(const [a,b] of [["MAMORASA RENTA SL","MAMORASA SL"],["FARMACIA ROMA","FARMACIA ROCA"],["ALLIANZ CARE","ALLIANCE HEALTHCARE"],["SUAVIWAO","SUAVIWAO 2025"]])assert.notEqual(supplierIdentityRoot(a),supplierIdentityRoot(b));
});
