import test from "node:test";
import assert from "node:assert/strict";
import {presentSemanticResult,renderSemanticMarkdown,safeAssistantMarkdown,shortSummaryContext,validateShortSummary,composeOfficialSemanticAnswer} from "./semanticPresentation.js";

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

test("el modelo solo redacta una frase y la tabla queda idéntica a la verificada",()=>{
 const p=presentSemanticResult({estado:"ok",fuente:"ventas",periodo:{desde:"2026-10-22",hasta:"2026-10-22"},
  dimensiones:["farmacia"],metricas:["importe"],filas:[
   {farmaciaId:1,farmacia:"Abadía",importe:7392.15},
   {farmaciaId:2,farmacia:"Europa",importe:6851.53}
  ],advertencias:[]});
 const evidence=shortSummaryContext(p);
 assert.equal(evidence.hechos[0].tipo,"maximo");
 assert.match(evidence.hechos[0].texto,/Abadía.*7392,15 €/);
 assert.doesNotMatch(JSON.stringify(evidence),/farmaciaId|estado":"completo/);
 assert.match(JSON.stringify(evidence),/7392,15/);
 const summary="Se presentan las ventas de Abadía y Europa correspondientes al período consultado.";
 assert.equal(validateShortSummary(summary,p),summary);
 const answer=composeOfficialSemanticAnswer(p,summary);
 assert.equal(answer,"**Resumen:** "+summary+"\n\n"+renderSemanticMarkdown(p));
 assert.match(answer,/\| Abadía \| 7392,15 € \|/);
 assert.match(answer,/\| Europa \| 6851,53 € \|/);
});
test("un resumen falso o excesivo NO puede alterar el desglose oficial",()=>{
 const p=presentSemanticResult({estado:"ok",fuente:"ventas",dimensiones:["farmacia"],
  metricas:["importe"],filas:[{farmaciaId:1,farmacia:"Abadía",importe:7392.15}]});
 for(const bad of [
  "Las ventas totales ascendieron a 2.577.334,78 €.",
  "Europa lidera el ranking de ventas.",
  "Las ventas aumentaron significativamente gracias a una campaña.",
  "No hay datos de ventas.",
  "### Resultado\n| Farmacia | Ventas |",
  "{ \"resumen\": \"todo bien\" }"
 ]){
  assert.equal(validateShortSummary(bad,p),null,bad);
  const content=composeOfficialSemanticAnswer(p,bad);
  assert.match(content,/7392,15 €/);
  assert.doesNotMatch(content,/Europa lidera|2\.577\.334|campaña/);
  assert.ok(content.endsWith(renderSemanticMarkdown(p)));
 }
});
test("se mantiene la advertencia de proveedor desconocido y de selección incompleta",()=>{
 const purchases=presentSemanticResult({estado:"ok",fuente:"compras",dimensiones:["proveedor"],
  metricas:["importe"],filas:[{proveedor:null,importe:"670860.289839"}]});
 assert.equal(validateShortSummary("El proveedor no está identificado y el detalle no permite atribuirlo a un proveedor concreto.",purchases)!==null,true);
 assert.equal(validateShortSummary("Las compras corresponden al proveedor Acme.",purchases),null);
 const answer=composeOfficialSemanticAnswer(purchases,"Las compras corresponden al proveedor Acme.");
 assert.ok(answer.includes("Proveedor no identificado"));
 assert.ok(answer.includes("670.860,29 €"));
 const partial=presentSemanticResult({estado:"ok",fuente:"ventas",dimensiones:["farmacia","vendedor"],
  metricas:["importe"],filas:Array.from({length:30},(_,i)=>({
   farmaciaId:1,farmacia:"Abadía",vendedor:i,vendedorNombre:"Vendedor "+String.fromCharCode(65+i),importe:i
  }))},{maxRows:10});
 assert.notEqual(validateShortSummary("Se presentan los vendedores con sus importes respectivos.",partial),null);
 assert.equal(validateShortSummary("Abadía es la farmacia con mayores ventas.",partial),null);
 assert.ok(composeOfficialSemanticAnswer(partial,"").includes("solo 10 de 30 filas"));
});

test("hechos auditados: líder por vendedor, cambios por farmacia, importes y límites",()=>{
 const sale=presentSemanticResult({estado:"ok",fuente:"ventas",
  dimensiones:["farmacia","vendedor"],metricas:["importe"],filas:[
   {farmaciaId:1,farmacia:"Abadía",vendedor:"6",vendedorNombre:"SILVIA RODRIGUEZ",importe:270713.7},
   {farmaciaId:2,farmacia:"Europa",vendedor:"5",vendedorNombre:"BEATRIZ DELGADO",importe:212600.9}
  ]});
 assert.equal(sale.hechos[0].tipo,"maximo");
 assert.match(sale.hechos[0].texto,/270.713,70 €/);
 assert.doesNotMatch(JSON.stringify(sale.hechos),/farmaciaId|vendedorNombre/);
 assert.equal(validateShortSummary("SILVIA RODRIGUEZ lidera las ventas con 270.713,70 €.",sale),
  "SILVIA RODRIGUEZ lidera las ventas con 270.713,70 €.");
 for(const invalid of [
  "BEATRIZ DELGADO lidera las ventas con 270.713,70 €.",
  "SILVIA RODRIGUEZ lidera las ventas con 275.713,70 €.",
  "SILVIA RODRIGUEZ lidera las ventas con 270.713,70 € por una campaña especial.",
  "Las ventas de SILVIA RODRIGUEZ superan un millón de euros."
 ])assert.equal(validateShortSummary(invalid,sale),null,invalid);
 const comp=presentSemanticResult({estado:"ok",consulta:{fuente:"ventas"},
  comparacion:{dimensiones:["farmacia"],unidad:"EUR",
   anterior:{desde:"2026-09-01",hasta:"2026-09-15"},
   actual:{desde:"2026-10-01",hasta:"2026-10-15"}},
  filas:[
   {farmaciaId:5,farmacia:"Valdemarías",estado:"completo",anterior:68359.42,
    actual:74376.75,diferencia:6017.33,variacion_pct:8.8},
   {farmaciaId:1,farmacia:"Abadía",estado:"completo",anterior:121135.95,
    actual:110565.47,diferencia:-10570.48,variacion_pct:-8.73}
  ]});
 assert.deepEqual(comp.hechos.map(x=>x.tipo),["aumento","descenso"]);
 assert.notEqual(validateShortSummary(
  "Valdemarías registra un aumento de 6.017,33 €. Abadía una disminución de -10.570,48 €.",comp),null);
 assert.equal(validateShortSummary(
  "Abadía registra un aumento de 8,80 % y Valdemarías una disminución de -10.570,48 €.",comp),null);
 assert.equal(validateShortSummary("Abadía registra un aumento del 8,80 %.",comp),null);
 assert.equal(validateShortSummary("Europa aumentó sus ventas durante octubre.",comp),null);
 assert.equal(validateShortSummary("Valdemarías aumentó un 10 %.",comp),null);
 const purchases=presentSemanticResult({estado:"ok",fuente:"compras",
  dimensiones:["proveedor"],metricas:["importe"],filas:[{proveedor:null,importe:670860.289839}]});
 assert.match(purchases.hechos[0].texto,/670.860,29 €/);
 assert.notEqual(validateShortSummary(
  "El proveedor no identificado registra 670.860,29 € de compras.",purchases),null);
 assert.equal(validateShortSummary("El proveedor Acme recibe 670.860,29 €.",purchases),null,
  "proveedores inexistentes no pueden ser atribuidos");
});


test("hechos verificables para ventas por día y márgenes estimados",()=>{
 const days=presentSemanticResult({estado:"ok",fuente:"ventas",dimensiones:["dia"],
  metricas:["importe"],filas:[
   {dia:"2026-10-21",importe:350},
   {dia:"2026-10-22",importe:400}
  ]});
 assert.equal(days.hechos[0]?.tipo,"maximo");
 assert.match(days.hechos[0].texto,/2026-10-22/);
 assert.match(days.hechos[0].texto,/400,00 €/);
 assert.notEqual(validateShortSummary(
  "El día 2026-10-22 registra la mayor cifra de ventas con 400,00 €.",days),null);

 const margin=presentSemanticResult({estado:"ok",fuente:"ventas",
  dimensiones:["farmacia"],metricas:["margen_estimado_pct"],
  filas:[{farmacia:"Abadía",margen_estimado_pct:20.12},
   {farmacia:"Europa",margen_estimado_pct:18.03}]});
 assert.equal(margin.hechos[0]?.tipo,"maximo");
 assert.match(margin.hechos[0].texto,/Abadía/);
 assert.match(margin.hechos[0].texto,/20,12 %/);
 assert.notEqual(validateShortSummary(
  "Abadía registra la mayor cifra de margen estimado con 20,12 %.",margin),null);
 assert.equal(validateShortSummary("Abadía registra un margen de 45 %.",margin),null);
});

test("chat comercial: el resumen financiero depende solo del servidor",()=>{
 const p=presentSemanticResult({estado:"ok",fuente:"ventas",
  periodo:{desde:"2026-10-01",hasta:"2026-10-23"},dimensiones:["farmacia"],
  metricas:["importe"],filas:[
   {farmacia:"Abadía",farmaciaId:1,importe:7392.15},
   {farmacia:"Europa",farmaciaId:2,importe:6851.53}],
  advertencias:["margen_estimado usa PMC ACTUAL; la venta histórica puede haber tenido otro coste."]});
 const text=composeOfficialSemanticAnswer(p,"La abadia lleva abadia este año.",{chatMode:true});
 assert.match(text,/Abadía registra la mayor cifra de ventas/);
 assert.match(text,/\| Abadía \| 7392,15 € \|/);
 assert.doesNotMatch(text,/lleva abadia|Resumen:|PMC ACTUAL/);
 assert.match(renderSemanticMarkdown(p),/PMC ACTUAL/);
});
test("chat comercial: explicación de margen simplificada",()=>{
 const p=presentSemanticResult({estado:"ok",fuente:"ventas",
  dimensiones:["farmacia"],metricas:["margen_estimado_pct"],
  filas:[{farmacia:"Abadía",margen_estimado_pct:20.12}],
  advertencias:["margen_estimado usa PMC ACTUAL; la venta histórica puede haber tenido otro coste."]});
 const answer=composeOfficialSemanticAnswer(p,"",{chatMode:true});
 assert.match(answer,/20,12 %/);
 assert.match(answer,/El margen es orientativo: utiliza el coste de compra actual/);
 assert.doesNotMatch(answer,/PMC ACTUAL/);
});
