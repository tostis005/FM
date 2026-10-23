import test from "node:test";
import assert from "node:assert/strict";
import {presentSemanticResult,renderSemanticMarkdown,safeAssistantMarkdown} from "./semanticPresentation.js";

test("ventas: muestra nombres e importes en EUR pero no IDs ni estados técnicos",()=>{
 const input={estado:"ok",fuente:"ventas",periodo:{desde:"2026-10-22",hasta:"2026-10-22"},
  dimensiones:["farmacia"],metricas:["importe"],limite:30,
  filas:[{farmaciaId:1,farmacia:"Abadía",importe:7392.15},
   {farmaciaId:2,farmacia:"Europa",importe:6851.53}],advertencias:[]};
 const p=presentSemanticResult(input);
 assert.deepEqual(p.columnas,["Farmacia","Ventas"]);
 assert.deepEqual(p.filas[0],{Farmacia:"Abadía",Ventas:"7392,15 €"});
 assert.doesNotMatch(JSON.stringify(p),/farmaciaId|estado":"completo|7392\.15/);
 const md=renderSemanticMarkdown(p);
 assert.match(md,/\| Farmacia \| Ventas \|/);
 assert.match(md,/7392,15 €/);
 assert.doesNotMatch(md,/(?:farmaciaId|vendedorNombre)/);
 assert.equal(safeAssistantMarkdown("**Ventas por farmacia**\n\n| Farmacia | Ventas |\n|---|---|\n| Abadía | 7392,15 € |\n| Europa | 6851,53 € |",p).startsWith("**Ventas"),true);
 assert.equal(safeAssistantMarkdown("Las farmacias vendieron 2.577.334,78 EUR",p),md,
  "debe sustituir cifras inventadas por Markdown verificable");
});
test("compra sin proveedor: no atribuir a proveedor real ni exponer null",()=>{
 const p=presentSemanticResult({estado:"ok",fuente:"compras",periodo:{desde:"2026-10-01",hasta:"2026-10-22"},
  dimensiones:["proveedor"],metricas:["importe"],filas:[{proveedor:null,importe:"670860.289839"}],
  advertencias:[]});
 assert.deepEqual(p.filas,[{Proveedor:"Proveedor no identificado",Compras:"670.860,29 €"}]);
 assert.ok(p.advertencias.some(x=>x.includes("no permiten un desglose")));
 assert.doesNotMatch(JSON.stringify(p),/null|proveedor":null|farmaciaId/);
 const rendered=renderSemanticMarkdown(p);
 assert.match(rendered,/Proveedor no identificado/);
 assert.equal(safeAssistantMarkdown("No hay datos disponibles.",p),rendered);
});
test("vendedores: nombres comerciales visibles, IDs ERP ocultos incluso sin nombre",()=>{
 const p=presentSemanticResult({estado:"ok",fuente:"ventas",dimensiones:["farmacia","vendedor"],
  metricas:["importe"],limite:30,filas:[
   {farmaciaId:1,farmacia:"Abadía",vendedor:"6",vendedorNombre:"SILVIA RODRIGUEZ",importe:270713.7},
   {farmaciaId:2,farmacia:"Europa",vendedor:"77",vendedorNombre:"77",importe:123}]});
 assert.deepEqual(p.filas[0],{Farmacia:"Abadía",Vendedor:"SILVIA RODRIGUEZ",Ventas:"270.713,70 €"});
 assert.equal(p.filas[1].Vendedor,"Vendedor no identificado");
 assert.doesNotMatch(JSON.stringify(p),/"farmaciaId"|"vendedor"|"77"/);
 const short=presentSemanticResult({...{estado:"ok",fuente:"ventas",dimensiones:["vendedor"],
  metricas:["importe"]},filas:Array.from({length:30},(_,i)=>({vendedor:i,vendedorNombre:"Persona "+i,importe:i}))},{maxRows:5});
 assert.equal(short.filas.length,5);
 assert.ok(short.advertencias.some(x=>x.includes("solo 5 de 30")));
});
test("comparaciones: conservan signos y períodos sin enviar estado completo",()=>{
 const p=presentSemanticResult({estado:"ok",consulta:{fuente:"ventas"},
  comparacion:{dimensiones:["farmacia"],unidad:"EUR",metrica:"importe",
   anterior:{desde:"2026-09-01",hasta:"2026-09-15"},
   actual:{desde:"2026-10-01",hasta:"2026-10-15"}},
  filas:[
   {farmaciaId:1,farmacia:"Abadía",estado:"completo",anterior:100,actual:90,diferencia:-10,variacion_pct:-10},
   {farmaciaId:2,farmacia:"Europa",estado:"sin_datos_anteriores",anterior:null,actual:50,diferencia:null,variacion_pct:null}
  ]});
 assert.equal(p.filas[0].Diferencia,"-10,00 €");
 assert.equal(p.filas[0].Variación,"-10,00 %");
 assert.equal(p.filas[1].Diferencia,"No calculable");
 assert.equal(p.filas[1].Anterior,"No calculable");
 assert.doesNotMatch(JSON.stringify(p),/farmaciaId|estado":"completo|sin_datos_anteriores/);
 const md=renderSemanticMarkdown(p);
 assert.match(md,/2026-09-01/);
 assert.match(md,/2026-10-01/);
});
test("respuesta ambigua se mantiene sin SQL ni datos técnicos",()=>{
 const p=presentSemanticResult({estado:"aclaracion",mensaje:"Indica un período"});
 assert.deepEqual(p,{estado:"aclaracion",mensaje:"Indica un período"});
 assert.equal(renderSemanticMarkdown(p),"Indica un período");
});
