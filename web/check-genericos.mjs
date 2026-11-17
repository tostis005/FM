import {chromium} from "playwright";
import assert from "node:assert/strict";
const BASE=process.env.RESPONSIVE_BASE_URL||"http://127.0.0.1:4175";
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1280,height:850}});
const user={email:"qa@example.com",role:"superadministrador",name:"QA"};
const modules={promociones:true,ventas:true,dashboard:true,genericos:true};
const pharmacies=[{id:"1",name:"Farmacia Centro",sourceCode:"ABA",active:true},{id:"2",name:"Farmacia Norte",sourceCode:"NOR",active:true}];
const context={user,client:{slug:"ampedia",name:"Ampedia",schema:"ampedia"},
 clients:[{slug:"ampedia",name:"Ampedia"}],pharmacies,modules,role:"superadministrador"};
let headerSeen=false;
let listRequests=0,detailRequests=0,catalogRequests=0,movementsRequests=0,failMetrics=false;
let genericSalesRequests=0,failGenericSales=false;
const savedGoals=[],savedOrders=[];
await page.route("**/api/**",async route=>{
 const req=route.request(),u=new URL(req.url()),p=u.pathname;
 let data={};
 if(p==="/api/auth/me")data={user};
 else if(p==="/api/tenant/context")data=context;
 else if(p==="/api/tenant/promociones")data={promotions:[]};
 else if(p==="/api/tenant/farmacias")data=pharmacies;
 else if(p==="/api/genericos/ofertas/estado")data={
  summary:{total:3,matched:3,groups:3,laboratories:3,
   filename:"RESUMEN TODOS LOS LABORATORIOS.xlsx",importedAt:"2026-11-16T12:00:00Z"},
  laboratories:[{name:"CINFA",offers:1},{name:"NORMON",offers:1},{name:"SANDOZ",offers:1}]
 };
 else if(p==="/api/genericos/ofertas/proveedores")data={items:[
  {id:"51",name:"Laboratorio Normon"},{id:"52",name:"Laboratorio Cinfa"}]};
 else if(p==="/api/genericos/ofertas/catalogo")data={items:[
  {dcpf:"111",principle:"PARACETAMOL",name:"Paracetamol 500 mg 20 comprimidos",
   strength:"500 mg",form:"Comprimidos",pack:"20 comprimidos",laboratories:2,offers:2,bestPuc:1.1},
  {dcpf:"112",principle:"PARACETAMOL",name:"Paracetamol 1 g 20 comprimidos",
   strength:"1 g",form:"Comprimidos",pack:"20 comprimidos",laboratories:1,offers:1,bestPuc:2.1},
  {dcpf:"113",principle:"OMEPRAZOL",name:"Omeprazol 20 mg 28 cápsulas",
   strength:"20 mg",form:"Cápsulas",pack:"28 cápsulas",laboratories:1,offers:1,bestPuc:3.1}
 ]};
 else if(p==="/api/genericos/ofertas/ventas"){
  genericSalesRequests++;
  const body=req.postDataJSON();
  assert.ok(["111","112","113"].some(id=>body.dcpfs.includes(id)),
   "El comparador consulta las ventas de presentaciones DCPF visibles");
  if(failGenericSales){
   await route.fulfill({status:503,contentType:"application/json",
    body:JSON.stringify({error:"Consulta de ventas no disponible"})});return;
  }
  data={salesAvailable:true,items:(body.dcpfs||[]).map(dcpf=>({
   dcpf,units:body.detail&&dcpf==="111"?100:{"111":123,"112":45,"113":60}[dcpf]??0,
   ...(body.detail?{revenue:250,
    cns:dcpf==="111"?[{cn:"659407",units:40},{cn:"663922",units:60}]:[],
    pharmacies:dcpf==="111"?[
     {pharmacyId:"1",units:70,revenue:175},{pharmacyId:"2",units:30,revenue:75}
    ]:[]}:{})
  }))};
 }
 else if(p==="/api/genericos/ventas/catalogo"){
  await new Promise(resolve=>setTimeout(resolve,180));
  data={version:{sha256:"aa",fecha_fuente:"2026-10-18",importado_en:"2026-10-18",total_genericos:6000},total:2,
   items:[
    {dcpf:"123456789",principle:"Omeprazol",name:"Omeprazol A 20 mg 28 cápsulas",
     officialDescription:"Omeprazol 20 mg 28 cápsulas gastrorresistentes vía oral",
     skuCount:2,genericCount:2},
    {dcpf:"987654321",principle:"Omeprazol",name:"Omeprazol B 40 mg 14 cápsulas",
     officialDescription:"Omeprazol 40 mg 14 cápsulas gastrorresistentes vía oral",
     skuCount:1,genericCount:1}
   ]};
 }
 else if(p==="/api/genericos/ventas/metricas"){
  listRequests++;
  await new Promise(resolve=>setTimeout(resolve,650));
  if(failMetrics){
   await route.fulfill({status:503,contentType:"application/json",
    body:JSON.stringify({error:"Error de consulta simulado"})});return;
  }
  data={salesAvailable:true,purchasesAvailable:true,
   sales:[{dcpf:"123456789",units:22,revenue:240}],
   purchases:[{dcpf:"123456789",units:12,spend:118,cost:118,pricedUnits:12}]};
 }
 else if(p==="/api/genericos/ofertas/conjunto/111"){
  data={dcpf:"111",offers:[
   {laboratory:"CINFA",cn:"659407",name:"Paracetamol 500 mg",isGeneric:true,
    officialLaboratory:"Cinfa",pvl:2,discount:.4,net:1.2,iva:.04,puc:1.248},
   {laboratory:"NORMON",cn:"663922",name:"Paracetamol 500 mg",isGeneric:true,
    officialLaboratory:"Normon",pvl:1.5,discount:.4,net:.9,iva:.04,puc:.936}],
   objectives:[],destinations:[{laboratory:"NORMON",supplierId:"51"},
    {laboratory:"CINFA",supplierId:"52"}]};
 }
 else if(p==="/api/genericos/ofertas/objetivos/111"&&req.method()==="PUT"){
  savedGoals.push(req.postDataJSON());
  data={saved:true,count:savedGoals.at(-1).goals.length};
 }
 else if(p==="/api/genericos/ofertas/preparar"&&req.method()==="POST"){
  savedOrders.push(req.postDataJSON());
  data={saved:true,laboratories:[{laboratory:"NORMON",lines:1},{laboratory:"CINFA",lines:1}],
   replaced:[]};
 }
 else if(p==="/api/genericos/ofertas/historico/111"){
  await new Promise(resolve=>setTimeout(resolve,700));
  data={dcpf:"111",from:u.searchParams.get("desde"),to:u.searchParams.get("hasta"),
   policy:{global:{percentile:20,months:6},overrides:[]},
   pharmacies:[{pharmacyId:"1",referencePuc:1.6,percentile:20,months:6,sampleLines:4},
    {pharmacyId:"2",referencePuc:1.6,percentile:20,months:6,sampleLines:4}],
   salesAvailable:false,purchasesAvailable:true};
 }
 else if(p==="/api/genericos/reales"&&u.searchParams.get("buscar")==="error-api"){
  await route.fulfill({status:503,contentType:"application/json",
   body:JSON.stringify({error:"Error de consulta simulado"})});return;
 }
 else if(p==="/api/genericos/reales"){
  listRequests++;
  await new Promise(resolve=>setTimeout(resolve,650));
  data={version:{sha256:"aa",fecha_fuente:"2026-10-18",importado_en:"2026-10-18",total_genericos:6000},
    totalGroups:2,summary:{salesUnits:22,revenue:240,purchases:118,savings:19.68},policy:{global:{percentile:20,months:6},overrides:[]},
    groups:[{dcpf:"123456789",principle:"Omeprazol",name:"Omeprazol A 20 mg 28 cápsulas",
      officialDescription:"Omeprazol 20 mg 28 cápsulas gastrorresistentes vía oral",
      skuCount:2,genericCount:2,salesUnits:22,revenue:240,
      purchaseUnits:12,spent:118,averagePuc:9.84,averagePvp:15,pvpMarginPct:34.4,bestPuc:8.2,indicativeSavings:19.68},
     {dcpf:"987654321",principle:"Omeprazol",name:"Omeprazol B 40 mg 14 cápsulas",
      officialDescription:"Omeprazol 40 mg 14 cápsulas gastrorresistentes vía oral",
      skuCount:1,genericCount:1,salesUnits:0,revenue:0,spent:0,averagePuc:null,averagePvp:null,
      bestPuc:null,indicativeSavings:null}],
    sales:{available:true},purchases:{available:true}};
 }
 else if(p==="/api/genericos/reales/123456789"){
  detailRequests++;
  assert.equal(u.searchParams.get("vista"),"articulos");
  headerSeen=req.headers()["x-farmetrica-cliente"]==="ampedia";
  const products=[
   {cn:"654321",nombre:"Omeprazol A 20 mg",laboratorio:"Lab A",
    soldUnits:27,soldAmount:295,buyUnits:14,buyAmount:144,puc:144/14},
   {cn:"654322",nombre:"Omeprazol B 20 mg",laboratorio:"Lab B",
    soldUnits:0,soldAmount:0,buyUnits:0,buyAmount:0,puc:null}
  ];
  if(u.searchParams.get("soloCatalogo")==="1"){
   catalogRequests++;
   data={view:"articles",products:products.map(p=>({...p,
    soldUnits:0,soldAmount:0,buyUnits:0,buyAmount:null,puc:null})),
    salesAvailable:null,purchasesAvailable:null,movementsPending:true};
  }else{
   movementsRequests++;
   await new Promise(resolve=>setTimeout(resolve,700));
   if(movementsRequests===1){
    await route.fulfill({status:503,contentType:"application/json",
     body:JSON.stringify({error:"Consulta de movimientos agotada"})});return;
   }
   data={view:"articles",products,salesAvailable:true,purchasesAvailable:true};
  }
 }
 else if(p==="/api/ventas/seguimiento")data={sales:{}};
 await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(data)});
});
try{
 await page.goto(BASE+"/genericos",{waitUntil:"domcontentloaded"});
 // El comparador comercial es la vista principal; conservar la cobertura del análisis.
 await page.getByRole("heading",{name:"Genéricos · Comparador de compras"}).waitFor();
 await page.getByRole("heading",{name:"1. Busca y selecciona un genérico"}).waitFor();
 const molecule=page.getByRole("combobox",{name:"Buscar y seleccionar molécula"});
 await molecule.waitFor();
 assert.equal(await molecule.inputValue(),"","Todas las moléculas no debe ocupar el campo de búsqueda");
 assert.match(await molecule.getAttribute("placeholder"),/Todas las moléculas/);
 await molecule.fill("parac");
 await page.getByRole("option",{name:"PARACETAMOL"}).click();
 assert.equal(await molecule.inputValue(),"PARACETAMOL");
 await page.getByRole("button",{name:"Mostrar resultados"}).click();
 await page.waitForFunction(()=>document.querySelectorAll(".fm-gof-catalog-table tbody tr").length===2);
 assert.equal(await page.locator(".fm-gof-catalog-table tbody tr").count(),2,
  "Una molécula muestra todas sus presentaciones tarifadas");
 await page.waitForFunction(()=>
  document.querySelector(".fm-gof-catalog-table tbody tr td:nth-child(6)")?.textContent.trim()==="123",
  null,{timeout:12000});
 assert.equal((await page.locator(".fm-gof-catalog-table tbody tr").first().locator("td").nth(5).innerText()).trim(),"123",
  "El comparador muestra las unidades reales recibidas de la API de ventas");
 assert.ok(genericSalesRequests>0,"Se ha consultado el endpoint de unidades del comparador");
 await page.getByLabel("Dosis o concentración").selectOption("500 mg");
 await page.getByRole("button",{name:"Mostrar resultados"}).click();
 assert.equal(await page.locator(".fm-gof-catalog-table tbody tr").count(),1,
  "Una dosis reduce el listado sin mezclar presentaciones");
 failGenericSales=true;
 await page.getByRole("combobox",{name:"Período"}).selectOption("3");
 await page.getByRole("button",{name:"Reintentar ventas"}).waitFor({timeout:12000});
 assert.equal((await page.locator(".fm-gof-catalog-table tbody tr td").nth(5).innerText()).trim(),"—",
  "Si falla la API, no se muestra un falso cero");
 failGenericSales=false;
 await page.getByRole("button",{name:"Reintentar ventas"}).click();
 await page.waitForFunction(()=>
  document.querySelector(".fm-gof-catalog-table tbody tr td:nth-child(6)")?.textContent.trim()==="123",
  null,{timeout:12000});
 await page.getByRole("combobox",{name:"Período"}).selectOption("12");
 await page.getByRole("button",{name:"Comparar precios"}).click();
 assert.equal(await page.getByLabel(/Proveedor de pedido/).count(),0,
  "No se debe mostrar selección de proveedor en el comparador");
 await page.getByRole("heading",{name:"2. Comparativa y objetivo de redirección"}).waitFor();
 await page.locator(".fm-gof-history-kpis").getByText("100",{exact:true}).waitFor({timeout:12000});
 assert.match(await page.locator(".fm-gof-table tbody").innerText(),/40/);
 assert.match(await page.locator(".fm-gof-table tbody").innerText(),/60/);
 assert.equal(await page.getByText("Vendidas (uds.)",{exact:true}).count()>0,true,
  "La tabla muestra ventas históricas por laboratorio");
 await page.getByRole("spinbutton",{name:/Volumen previsto para 30 días/}).waitFor();
 assert.ok(Number(await page.getByRole("spinbutton",{name:/Volumen previsto para 30 días/}).inputValue())>0,
  "Volumen de pedido rellenado automáticamente según ventas");

 const targetPercent=page.getByRole("spinbutton",{name:"Porcentaje numérico de redirección"});
 await targetPercent.fill("50");
 await page.getByRole("button",{name:"Elegir como destino"}).first().click();
 assert.equal(await page.getByRole("button",{name:"Laboratorio elegido"}).count(),1,
  "Solo hay un laboratorio de redirección para todo el genérico");
 assert.equal(await page.getByRole("spinbutton",{name:/Porcentaje numérico NORMON/}).count(),0,
  "No se muestran porcentajes editables por cada laboratorio");
 await page.locator(".fm-gof-history-kpis").getByText(/35,00/).waitFor({timeout:10000});
 await targetPercent.fill("40");
 await page.locator(".fm-gof-history-kpis").getByText(/28,00/).waitFor({timeout:10000});
 await page.getByRole("button",{name:"Guardar objetivo de redirección"}).click();
 await page.getByText(/Objetivo guardado: 40/).waitFor({timeout:10000});
 assert.deepEqual(savedGoals.at(-1).goals.map(x=>({laboratory:x.laboratory,percent:x.percent})),
  [{laboratory:"NORMON",percent:40}],
  "Se guarda un solo destino con porcentaje global del conjunto");
 assert.match(await page.locator(".fm-gof-target-summary").innerText(),/60 % restante/);
 await page.getByRole("spinbutton",{name:/Volumen orientativo del genérico/}).fill("25");
 await page.getByRole("button",{name:/Regenerar propuesta para NORMON/}).click();
 const normon=page.getByRole("spinbutton",{name:"Pedir NORMON para Farmacia Centro"});
 const normonNorth=page.getByRole("spinbutton",{name:"Pedir NORMON para Farmacia Norte"});
 assert.equal(Number(await normon.inputValue())+Number(await normonNorth.inputValue()),10,
  "La propuesta aplica el 40 % de las 25 unidades al destino elegido");
 const cinfa=page.getByRole("spinbutton",{name:"Pedir CINFA para Farmacia Centro"});
 await cinfa.fill("3");
 await normon.fill("6");
 await normonNorth.fill("5");
 assert.equal(Number(await cinfa.inputValue()),3,"El resto se elige manualmente por laboratorio");
 assert.equal(Number(await normon.inputValue())+Number(await normonNorth.inputValue()),11,
  "Las unidades manuales no están bloqueadas por el objetivo comercial");
 page.once("dialog",dialog=>dialog.accept());
 await page.getByRole("button",{name:"Guardar borrador de pedido"}).click();
 await page.getByText(/Añadido a 2 borradores/).waitFor({timeout:10000});
 assert.equal(savedOrders.length,1);
 assert.equal(savedOrders[0].entries.length,2,
  "El pedido incluye los dos laboratorios con unidades manuales, no solo el destino comercial");
 assert.deepEqual(savedOrders[0].entries.find(x=>x.laboratory==="CINFA").unitsByPharmacy,
  {"1":3,"2":0});
 await page.getByRole("button",{name:"Configuración de tarifas"}).click();
 await page.getByRole("heading",{name:"Genéricos · Configuración de tarifas"}).waitFor();
 await page.getByText("RESUMEN TODOS LOS LABORATORIOS.xlsx",{exact:true}).first().waitFor();
 await page.getByRole("button",{name:"Análisis y rentabilidad"}).click();
 await page.getByRole("heading",{name:"Genéricos",exact:true}).waitFor();
 // El análisis puede haber precargado sus datos mientras se muestra el comparador.
 // Lanzar una lectura explícita permite seguir comprobando los estados de carga.
 await page.waitForTimeout(850);
 await page.getByRole("button",{name:"Actualizar",exact:true}).click();
 await page.waitForFunction(()=>document.querySelectorAll(".fm-generic-metric .fm-kpi-spinner").length===5,
  {timeout:7000});
 assert.equal(await page.locator(".fm-generic-chart .fm-loading-panel").count(),1);
 const alignment=await page.locator(".fm-generic-metric .fm-kpi-spinner").evaluateAll(items=>
  items.map(item=>{
   const spin=item.querySelector(".fm-load-spinner")?.getBoundingClientRect();
   const label=item.querySelector(".fm-kpi-loading-label")?.getBoundingClientRect();
   return spin&&label?Math.abs((spin.top+spin.height/2)-(label.top+label.height/2)):99;
  }));
 assert.ok(alignment.length===5&&alignment.every(delta=>delta<=2.5),
   "Spinner y texto deben estar centrados en todos los KPI: "+alignment);
 assert.equal(await page.locator(".fm-generic-list .fm-loading-panel").count(),1);
 // La molécula no puede sustituir al descriptor clínico con dosis y envase.
 await page.getByText("Omeprazol 20 mg 28 cápsulas gastrorresistentes vía oral",{exact:true}).first().waitFor({timeout:10000});
 await page.getByText("Omeprazol 40 mg 14 cápsulas gastrorresistentes vía oral",{exact:true}).first().waitFor({timeout:10000});
 assert.equal(await page.locator(".fm-generic-click-row").count(),2,
   "Distinta dosis y tamaño de envase deben aparecer como conjuntos distintos");
 await page.locator(".fm-generic-chart .recharts-bar-rectangle").first().waitFor({timeout:10000});
 assert.equal(await page.locator(".fm-generic-chart .recharts-bar-rectangle").count()>0,true);
 assert.equal(await page.getByText("revenue",{exact:true}).count(),0,
   "El gráfico debe emplear denominaciones en castellano");
 // El gráfico debe ocupar toda la zona de contenido del informe en escritorio,
 // no dejar una segunda columna vacía a su derecha.
 const chartWidth=await page.evaluate(()=>{
  const wrapper=document.querySelector(".fm-generic-panels");
  const chart=wrapper?.querySelector(".fm-generic-chart");
  if(!wrapper||!chart)return null;
  const a=wrapper.getBoundingClientRect(),b=chart.getBoundingClientRect();
  return {outerWidth:a.width,chartWidth:b.width,leftGap:b.left-a.left,rightGap:a.right-b.right};
 });
 assert.ok(chartWidth&&chartWidth.outerWidth>300&&
  chartWidth.chartWidth>=chartWidth.outerWidth-2&&
  Math.abs(chartWidth.leftGap)<=2&&Math.abs(chartWidth.rightGap)<=2,
  "Conjuntos con mayor venta debe ocupar todo el ancho: "+JSON.stringify(chartWidth));

 await page.getByRole("button",{name:"Desplegar conjunto 123456789"}).click();
 await page.getByText("Omeprazol A 20 mg",{exact:true}).waitFor();
 assert.equal(headerSeen,true,"La petición de detalle mantiene tenant explícito");
 assert.equal(catalogRequests,1,"El catálogo debe tener una sola lectura rápida");
 assert.ok(await page.locator(".fm-generic-detail table tbody tr").count()===2,
  "El catálogo aparece antes de los cálculos de ventas");
 assert.equal(await page.locator(".fm-generic-detail .fm-dual-scroll").count(),0,
  "El detalle no debe introducir otro scroll anidado");
 assert.equal(await page.locator(".fm-generic-detail .fm-table-toolbar").count(),0,
  "El detalle no debe tener filtros ni paginadores redundantes");
 assert.equal(await page.locator(".fm-generic-detail table").count(),1);
 assert.equal(await page.locator(".fm-generic-detail table tbody tr").count(),2);
 assert.equal(await page.getByText("Equivalente de referencia",{exact:true}).count(),0);
 assert.equal(await page.getByText("PUC óptimo",{exact:true}).count(),0);
 const firstRow=page.locator(".fm-generic-detail table tbody tr").first();
 assert.match(await firstRow.innerText(),/654321/);
 await page.getByText("Los artículos siguen disponibles.",{exact:false}).first().waitFor({timeout:9000});
 assert.equal(await page.locator(".fm-generic-detail table tbody tr").count(),2,
  "Un fallo de movimientos nunca debe eliminar los CN ya cargados");
 await page.getByRole("button",{name:"Reintentar movimientos"}).click();
 await page.waitForFunction(()=>document.querySelector(".fm-generic-detail table tbody tr")?.
   textContent.includes("27"),{timeout:9000});
 assert.match(await firstRow.innerText(),/27/,"Las ventas se recuperan al reintentar");
 const scrolls=await page.evaluate(()=>{
  const detail=document.querySelector(".fm-generic-detail");
  const parent=document.querySelector(".fm-generic-list .fm-generic-table-scroll");
  return {parent:!!parent,inner:[...detail.querySelectorAll("*")].filter(el=>
   /(auto|scroll)/.test(getComputedStyle(el).overflowX)&&el.scrollWidth>el.clientWidth+2).length};
 });
 assert.equal(scrolls.parent,true);
 assert.equal(scrolls.inner,0,"No hay scroll horizontal propio dentro del detalle");
 await page.getByRole("button",{name:"Desplegar conjunto 123456789"}).click();
 await page.getByRole("button",{name:"Desplegar conjunto 123456789"}).click();
 await page.getByText("Omeprazol A 20 mg",{exact:true}).waitFor();
 assert.equal(catalogRequests,1,"Reabrir reutiliza el catálogo");
 assert.equal(movementsRequests,2,"Reabrir no reconsulta los movimientos una vez completos");
 await page.setViewportSize({width:390,height:844});
 const mobileChart=await page.evaluate(()=>{
  const wrapper=document.querySelector(".fm-generic-panels"),chart=wrapper?.querySelector(".fm-generic-chart");
  if(!wrapper||!chart)return null;
  const a=wrapper.getBoundingClientRect(),b=chart.getBoundingClientRect();
  return {width:a.width,chartWidth:b.width};
 });
 assert.ok(mobileChart&&mobileChart.chartWidth>=mobileChart.width-2,
  "El gráfico también debe rellenar la columna en móvil: "+JSON.stringify(mobileChart));
 const mobile=await page.evaluate(()=>{
  const outer=document.querySelector(".fm-generic-list .fm-generic-table-scroll");
  const inner=document.querySelector(".fm-generic-detail");
  const top=document.querySelector(".fm-generic-list .fm-dual-scroll-top");
  return {outerScroll:outer?.scrollWidth>outer?.clientWidth,
   nestedScroll:[...inner.querySelectorAll("*")].some(el=>
    /auto|scroll/.test(getComputedStyle(el).overflowX)&&el.scrollWidth>el.clientWidth+2),
   extraTopVisible:top&&getComputedStyle(top).display!=="none"};
 });
 assert.equal(mobile.outerScroll,true,"En móvil se conserva el scroll de la tabla padre");
 assert.equal(mobile.nestedScroll,false,"En móvil no aparecen scrolls internos");
 assert.equal(mobile.extraTopVisible,false,"No duplicar las barras de desplazamiento");
 await page.setViewportSize({width:1280,height:850});
 // Recuperar foco no debe desmontar los conjuntos ni rehacer la petición.
 const initialRequests=listRequests;
 await page.evaluate(()=>{
  document.dispatchEvent(new Event("visibilitychange"));
  window.dispatchEvent(new Event("focus"));
 });
 await page.waitForTimeout(500);
 assert.equal(listRequests,initialRequests,"Genéricos se ha recargado por recuperar foco");
 await page.getByRole("button",{name:"Actualizar",exact:true}).click();
 await page.waitForFunction(()=>document.querySelector(".fm-generic-chart")!==null);
 await page.waitForTimeout(750);
 assert.ok(listRequests>initialRequests,"Actualizar explícitamente debe consultar genéricos");
 await page.getByPlaceholder("Buscar conjunto…").fill("sin-existencia");
 await page.getByText("Ningún conjunto coincide con los filtros de columna.",{exact:false}).first().waitFor();
 assert.equal(await page.locator(".fm-generic-click-row").count(),0,
  "Filtrar localmente no debe inventar grupos");
 await page.getByPlaceholder("Buscar conjunto…").fill("");
 failMetrics=true;
 await page.getByRole("button",{name:"Actualizar",exact:true}).click();
 await page.getByRole("alert").filter({hasText:"Error de consulta simulado"}).first().waitFor({timeout:10000});
 assert.equal(await page.locator(".fm-generic-click-row").count(),2,
  "Si falla el cálculo de ventas, se mantiene el catálogo oficial y puede reintentarse");
 console.log("OK: Genéricos carga por visual, muestra agrupación DCPF y desglose aislado por cliente");
}finally{await browser.close();}
