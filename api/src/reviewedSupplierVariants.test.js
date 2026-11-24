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
 assert.deepEqual(result.operations.map(x=>[x.from,x.to]).sort((a,b)=>a[0].localeCompare(b[0])),[["1","8"],["2","8"],["3","8"],["5","4"]]);
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
 assert.deepEqual(plan.operations.map(x=>[x.from,x.to]).sort((a,b)=>a[0].localeCompare(b[0])),[["2","1"],["3","4"]]);
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

test("prefijos cero y numeraciones del maestro no crean fichas duplicadas ni confunden establecimientos",()=>{
 const same=[
  ["0 AMPEDIA MERCANTIL SL","0-AMPEDIA MERCANTIL S.L.","0AMPEDIA MERCANTIL SL","001-AMPEDIA MERCANTIL SL (ALMACEN)","AMPEDIA MERCANTIL"],
  ["002-ABADÍA AMPEDIA (FARMACIA)","ABADÍA AMPEDIA"],
  ["003-ABADÍA FARMACIA","ABADÍA FARMACIA"],
  ["004-EUROPA AMPEDIA","EUROPA AMPEDIA"],
  ["005-EUROPA FARMACIA","EUROPA FARMACIA"],
  ["006-BUENAVISTA AMPEDIA","BUENAVISTA AMPEDIA"],
  ["007-BUENAVISTA FARMACIA","BUENAVISTA FARMACIA"],
  ["008-POLÍGONO AMPEDIA","POLÍGONO AMPEDIA"],
  ["009-POLÍGONO FARMACIA","POLÍGONO FARMACIA"],
  ["010-COMPENSACIONES DE PROMOCIONES","COMPENSACIONES DE PROMOCIONES"],
  ["014-CORRECCIÓN DE STOCKS","CORRECCIÓN DE STOCKS"]
 ];
 for(const group of same)for(const value of group)assert.equal(supplierIdentityRoot(value,"INTERNO"),supplierIdentityRoot(group[0],"INTERNO"),value);
 for(const [a,b] of [["002-ABADÍA AMPEDIA (FARMACIA)","003-ABADÍA FARMACIA"],["004-EUROPA AMPEDIA","005-EUROPA FARMACIA"],["006-BUENAVISTA AMPEDIA","007-BUENAVISTA FARMACIA"],["008-POLÍGONO AMPEDIA","009-POLÍGONO FARMACIA"],["019-ESTACION (AMPEDIA)","020-ESTACION (FARMACIA)"],["010-COMPENSACIONES DE PROMOCIONES","011-COMPENSACIONES CADUCADO/DEFECT"],["AMPEDIA NUEVA","AMPEDIA MERCANTIL"],["360IMPRIMIR.ES","IMPRIMIR.ES"]])assert.notEqual(supplierIdentityRoot(a,"INTERNO"),supplierIdentityRoot(b,"INTERNO"),a);
});

test("grupo mayorista revisado: Cofarta y Cofares; Cecofar y Bidafarma por separado",()=>{
 const cofares=["1-COFARTA","04 COFARTA COMERCIALIZ FARMACEUT","COFARTA OLIAS","2 COFARTA TALAVERA","99 TARDE COFARTA","COFARTA OLIAS TRANSFER","COFARTA PARAFARMACIA SL","1.-COFARTA COMERCIALIZADORA.FCA SL","1-.COFARTA COMERCIALIZ. FARMACEUT S","3-COFARES","03 COFARES ESPEC","4 COFARES, SOC COOP. FCA. ESPAÑOLA","COFARES SDAD.COOP.FARMCEUTICA ESPAÑ"];
 const bida=["2-BIDAFARMA","02 BIDA FARMA S COOP AND (CECOFAR)","3 BIDAFARMA S.COOP.","CECOFAR"];
 for(const n of cofares)assert.equal(supplierIdentityRoot(n,"MAYORISTA"),"COFARES",n);
 for(const n of bida)assert.equal(supplierIdentityRoot(n,"SIN_CLASIFICAR"),"BIDAFARMA",n);
 for(const n of ["COREFAR","COFARCA","COFARTE","COFARES INFORMATICA","CECOFAR INFORMATICA","ALLIANZ CARE","VIDAFARMA"])assert.ok(!["COFARES","BIDAFARMA"].includes(supplierIdentityRoot(n,"MAYORISTA")),n);
 const master=[{id:"1",name:"1-COFARTA",class:"MAYORISTA",active:true},{id:"2",name:"3-COFARES",class:"MAYORISTA",active:true},{id:"3",name:"04 COFARTA COMERCIALIZ FARMACEUT",class:"SIN_CLASIFICAR",active:true},{id:"4",name:"2-BIDAFARMA",class:"MAYORISTA",active:true},{id:"5",name:"02 BIDA FARMA S COOP AND (CECOFAR)",class:"SIN_CLASIFICAR",active:true}];
 const aliases=master.map(p=>({supplier:p.id,pharmacyCode:"ABA",sourceCode:p.id}));
 assert.deepEqual(planSupplierNameConsolidation(master,aliases).operations.map(o=>[o.from,o.to]).sort(),[["1","2"],["3","2"],["5","4"]]);
 assert.equal(planSupplierNameConsolidation(master,aliases,new Set(["1","2"])).operations.some(o=>o.from==="1"||o.from==="2"),false);
});
