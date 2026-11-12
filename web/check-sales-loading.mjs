// Ventas estratégica: resumen y tres análisis, sin recuentos ni tabla de artículos.
import {chromium} from "playwright";
const BASE=process.env.RESPONSIVE_BASE_URL||"http://127.0.0.1:4175";
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1280,height:850}});
const requests=[];
const user={email:"admin@test.example",role:"superadministrador",name:"Administrador"};
const pharmacies=[
 {id:"1",name:"Farmacia Centro",sourceCode:"ABA",databaseCode:"ABA",active:true},
 {id:"2",name:"Farmacia Norte",sourceCode:"NOR",databaseCode:"NOR",active:true}
];
const modules=Object.fromEntries(["dashboard","ventas","promociones"].map(x=>[x,true]));
const context={user,clients:[{slug:"ampedia",name:"Ampedia"}],
 client:{slug:"ampedia",name:"Ampedia",schema:"ampedia",analysisMonths:12},
 role:"superadministrador",pharmacies,modules};
const delay=ms=>new Promise(done=>setTimeout(done,ms));
await page.route("**/api/**",async route=>{
 const url=new URL(route.request().url()),p=url.pathname;
 let body={};
 if(p==="/api/auth/me")body={user};
 else if(p==="/api/tenant/context")body=context;
 else if(p==="/api/tenant/promociones")body={promotions:[]};
 else if(p==="/api/tenant/farmacias")body=pharmacies;
 else if(p==="/api/analytics/ventas/totales"){
  requests.push({path:p,query:Object.fromEntries(url.searchParams.entries())});
  await delay(450);
  const granularity=url.searchParams.get("granularidad")||"month";
  const from=url.searchParams.get("desde");
  const onlyCentro=url.searchParams.get("farmacias")==="1";
  const onlyNorte=url.searchParams.get("farmacias")==="2";
  const sales=onlyCentro?180:onlyNorte?54.5:234.5;
  const units=onlyCentro?9:onlyNorte?3:12;
  const bucket=granularity==="hour"?from+"T12:00":
    granularity==="day"?from:from.slice(0,7);
  body={from,to:url.searchParams.get("hasta"),granularity,
   monthly:[{month:from.slice(0,7),ventas:sales,unidades:units}],
   series:[{bucket,ventas:sales,unidades:units}],
   kpis:{ventas:sales,unidades:units}};
 }
 else if(p==="/api/analytics/ventas/recuento"){
  requests.push({path:p,query:Object.fromEntries(url.searchParams.entries())});
  await delay(1100);
  body={totalProducts:3,totalArticles:2};
 }
 else if(p==="/api/analytics/ventas/detalle"){
  requests.push({path:p,query:Object.fromEntries(url.searchParams.entries())});
  await delay(1450);
  const byColumn=JSON.parse(url.searchParams.get("columnas")||"{}");
  const letter=Array.isArray(byColumn.abcdClass)?byColumn.abcdClass[0]||"A":"A";
  body={products:[{id:"1|123456",pharmacyId:"1",cn:"123456",name:"Artículo",
    units:12,value:234.5,pvp:25,purchaseCost:8,saleUnitPrice:19.54,
    unitMargin:11.54,margin:138.48,abcdClass:letter}],
    totalFiltered:byColumn.abcdClass?31:25600,hasMore:false,page:1};
 }
 else if(p==="/api/analytics/ventas/ticket-medio-rapido"){
  requests.push({path:p,query:Object.fromEntries(url.searchParams.entries())});
  const ids=(url.searchParams.get("farmacias")||"1,2").split(",");
  const pharmaciesTickets=[
   {id:"1",name:"Farmacia Centro",tickets:5},
   {id:"2",name:"Farmacia Norte",tickets:3}
  ].filter(p=>ids.includes(p.id));
  body={tickets:pharmaciesTickets.reduce((sum,p)=>sum+p.tickets,0),
   pharmacies:pharmaciesTickets};
 }
 else if(p==="/api/analytics/ventas/panorama"){
  requests.push({path:p,query:Object.fromEntries(url.searchParams.entries())});
  const ids=(url.searchParams.get("farmacias")||"1,2").split(",");
  if(!requests.some(r=>r.path===p&&r.query.from==="prepared-once")){
   requests.push({path:p,query:{from:"prepared-once"}});
   await route.fulfill({status:202,contentType:"application/json",
    body:JSON.stringify({status:"preparing",missing:1,retryAfterMs:200})});
   return;
  }
  body={
   familias:{families:[
    {key:"dermocosmetica",name:"Dermocosmética",classified:true,segments:["PARAFARMACIA"],
     sales:180,units:9,lines:4},
    {key:"sin-clasificar",name:"Sin clasificar",classified:false,segments:[],sales:54.5,units:3,lines:2}
   ],totalSales:234.5,totalUnits:12,totalLines:6,classifiedLines:4,coveragePct:66.7},
   actividad:{
    horarios:{total:845,cells:[10,30,75,230,500].map((sales,i)=>({weekday:1,hour:9+i,sales,lines:1}))},
    vendedores:{total:234.5,sellers:[
     {name:"Ana",pharmacyId:"1",sales:180,units:9},
     {name:"Luis",pharmacyId:"2",sales:54.5,units:3}
    ].filter(p=>ids.includes(p.pharmacyId))}
   }
  };
 }
 else if(p==="/api/analytics/ventas/horarios-tickets"){
  body={cells:[10,30,75,230,500].map((tickets,i)=>({
   weekday:1,hour:9+i,tickets,units:[1,3,9,30,60][i]
  })),total:845,totalUnits:103};
 }
 else if(["/api/analytics/dashboard/horarios","/api/analytics/dashboard/vendedores",
  "/api/analytics/ventas/ticket-medio"].includes(p)){
  requests.push({path:p,query:Object.fromEntries(url.searchParams.entries())});
  body={error:"Endpoint independiente obsoleto en la pantalla Ventas"};
 }
 else if(p==="/api/analytics/ventas/familias")body={families:[]};
 else if(p==="/api/health/database")body={status:"ok",database:"connected"};
 await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});
});
const totals=()=>requests.filter(r=>r.path==="/api/analytics/ventas/totales");
async function verifyPeriod(expected){
 await page.waitForFunction(()=>{
   const graph=document.querySelector(".fm-demo-graph");
   const kpi=document.querySelector(".fm-demo-kpi strong");
   return graph?.getAttribute("aria-busy")==="false"&&
     Boolean(kpi&&kpi.textContent?.trim()!=="—");
 },null,{timeout:14000});
 const latest=totals().at(-1);
 if(!latest||latest.query.granularidad!==expected)
  throw Error("Granularidad incorrecta: "+JSON.stringify(latest));
 const current=latest.query;
 for(const endpoint of [
  "/api/analytics/ventas/panorama",
  "/api/analytics/ventas/ticket-medio-rapido"
 ]){
  await page.waitForFunction(([path,from,to])=>{
   return Boolean(document.querySelector(".fm-so-family")&&
    document.querySelector(".fm-dashboard-insights")&&
    document.querySelector(".fm-demo-kpi[aria-label='Ticket medio']"));
  },[endpoint,current.desde,current.hasta],{timeout:12000});
  const hits=requests.filter(r=>r.path===endpoint&&
   r.query.desde===current.desde&&r.query.hasta===current.hasta);
  if(!hits.length){
   await page.waitForTimeout(300);
   if(!requests.some(r=>r.path===endpoint&&r.query.desde===current.desde&&r.query.hasta===current.hasta))
    throw Error("No se consultó "+endpoint+" para los filtros del resumen");
  }
 }
 return totals().length;
}
const forbidden=[
 "/api/analytics/ventas/recuento","/api/analytics/ventas/detalle",
 "/api/analytics/ventas/ticket-medio","/api/analytics/ventas/familias-ranking",
 "/api/analytics/ventas/actividad","/api/analytics/dashboard/horarios",
 "/api/analytics/dashboard/vendedores"
];
const noHeavyDetails=()=>{
 const duplicate=requests.filter(r=>forbidden.includes(r.path));
 if(duplicate.length)throw Error("Ventas no debe recuperar artículos ni consultas obsoletas: "+JSON.stringify(duplicate));
};
try{
 await page.goto(BASE+"/ventas",{waitUntil:"domcontentloaded"});
 await page.locator(".fm-demo-kpi").first().waitFor({state:"visible",timeout:15000});
 await verifyPeriod("month");
 await page.getByText("Ventas por familias",{exact:true}).waitFor();
 await page.getByText("Dermocosmética",{exact:true}).waitFor();
 const ticketKpi=page.locator(".fm-demo-kpi").filter({hasText:"Ticket medio"});
 await ticketKpi.waitFor({state:"visible"});
 await ticketKpi.locator("strong").getByText("29,31", {exact:false}).waitFor();
 if(await page.locator(".fm-demo-kpi").count()!==3)
  throw Error("Ventas debe mostrar tres KPI: ventas, unidades y ticket medio");
 const pharmacyPanel=page.locator(".fm-so-pharmacies");
 await pharmacyPanel.waitFor({state:"visible"});
 await page.getByRole("heading",{name:"Ventas por farmacia"}).waitFor();
 if(await pharmacyPanel.locator(".fm-so-site").count()!==2)
  throw Error("Deben aparecer dos farmacias cuando el filtro incluye ambas");
 await page.getByRole("heading",{name:"Ventas por vendedor"}).waitFor();
 const headings=await page.locator(".fm-sales-card-heading").evaluateAll(nodes=>nodes.map(node=>({
  title:node.querySelector("h2")?.textContent?.trim(),
  size:window.getComputedStyle(node.querySelector("h2")).fontSize,
  icon:node.querySelector(".fm-sales-card-heading-icon")?.getBoundingClientRect().width,
  description:node.querySelector("p")?.textContent||""
 })));
 if(headings.length!==5||headings.some(h=>h.icon!==38||h.size!==headings[0].size||h.description))
  throw Error("Los cinco bloques de Ventas deben usar títulos e iconos homogéneos: "+JSON.stringify(headings));
 const familyTitle=await page.locator(".fm-so-family .fm-sales-card-heading").innerText();
 if(familyTitle.trim()!=="Ventas por familias")
  throw Error("El título de familias no debe tener información superpuesta");
 if(await page.getByText("líneas clasificadas",{exact:false}).count())
  throw Error("El porcentaje de líneas clasificadas no debe mostrarse en el ranking");
 for(const removed of [
  "Las barras muestran diferencias",
  "Ordenadas de mayor a menor",
  "El ranking se calcula con el importe neto",
  "Escala relativa a las franjas"
 ]){
  if(await page.getByText(removed,{exact:false}).count())
   throw Error("Texto explicativo redundante en Ventas: "+removed);
 }
 const initialTicketCalls=requests.filter(r=>r.path==="/api/analytics/ventas/ticket-medio-rapido").length;
 if(initialTicketCalls!==1)
  throw Error("El KPI y la comparación deben compartir una sola consulta de tickets");
 await page.getByRole("button",{name:"Filtrar por Farmacias"}).click();
 await page.getByRole("dialog",{name:"Seleccionar Farmacias"}).getByRole("checkbox",{name:"Farmacia Centro"}).check();
 await page.getByRole("button",{name:"Listo"}).click();
 await page.waitForFunction(()=>!document.querySelector(".fm-so-pharmacies"),null,{timeout:10000});
 await ticketKpi.locator("strong").getByText("36,00",{exact:false}).waitFor({timeout:12000});
 if(await page.locator(".fm-so-grid-single").count()!==1)
  throw Error("La clasificación debe ocupar todo el ancho con una sola farmacia");
 if(requests.filter(r=>r.path==="/api/analytics/ventas/ticket-medio-rapido"&&r.query.farmacias==="1").length!==1)
  throw Error("Filtrar una farmacia debe hacer una única consulta nueva de tickets");
 await page.getByRole("button",{name:"Filtrar por Farmacias"}).click();
 await page.getByRole("dialog",{name:"Seleccionar Farmacias"}).getByRole("button",{name:"Limpiar"}).click();
 await page.getByRole("button",{name:"Listo"}).click();
 await pharmacyPanel.waitFor({state:"visible",timeout:12000});
 await page.getByRole("group",{name:"Indicador de familias"})
  .getByRole("button",{name:"Unidades",exact:true}).click();
 await page.getByText("9 uds.",{exact:true}).waitFor();
 const unitShares=await page.locator(".fm-so-family .fm-so-rank-share").allTextContents();
 if(!unitShares.includes("75 %")||!unitShares.includes("25 %"))
  throw Error("En unidades deben mostrarse las cuotas sobre las 12 unidades: "+JSON.stringify(unitShares));
 await page.getByRole("group",{name:"Indicador de familias"})
  .getByRole("button",{name:"Ventas €",exact:true}).click();
 const salesShares=await page.locator(".fm-so-family .fm-so-rank-share").allTextContents();
 if(!salesShares.some(value=>value.includes("76,8")))
  throw Error("La cuota por importe debe conservarse: "+JSON.stringify(salesShares));
 if(await page.getByText("Artículos diferentes",{exact:true}).count()||
    await page.getByText("Referencias por farmacia",{exact:true}).count()||
    await page.getByRole("heading",{name:"Artículos vendidos"}).count()||
    await page.locator("#fm-sales-articles").count())
  throw Error("Ventas debe mostrar visión estratégica y no detalle de artículos");
 const order=await page.evaluate(()=>{
  const overview=document.querySelector(".fm-so-overview");
  const map=document.querySelector(".fm-dashboard-insights .fm-insight-panel");
  return Boolean(overview&&map&&overview.compareDocumentPosition(map)&Node.DOCUMENT_POSITION_FOLLOWING);
 });
 if(!order)throw Error("Las familias y la comparación deben aparecer antes del mapa");
 await page.locator(".fm-heat-legend-swatch").first().waitFor({state:"visible",timeout:12000});
 const heatColors=await page.locator(".fm-heat-cell").evaluateAll(cells=>
  [...new Set(cells.map(el=>getComputedStyle(el).backgroundColor))]);
 if(heatColors.length<6)throw Error("El mapa necesita cinco intensidades y cero");
 // Tres alcances deliberados: todas, solo Centro y todas otra vez.
 // Al mover el ticket medio no deben aparecer consultas duplicadas por visual.
 if(totals().length!==3)
  throw Error("Se espera un único total por cambio de farmacia: "+
   JSON.stringify(totals().map(r=>r.query)));
 noHeavyDetails();
 await page.locator(".fm-unified-filters select").first().selectOption("today");
 await verifyPeriod("hour");
 await page.locator(".fm-unified-filters select").first().selectOption("this_week");
 await verifyPeriod("day");
 await page.locator(".fm-unified-filters select").first().selectOption("custom");
 await page.locator(".fm-unified-filters input[type=date]").first().fill("2026-10-05");
 await page.locator(".fm-unified-filters input[type=date]").last().fill("2026-10-12");
 await page.waitForFunction(()=>document.querySelector(".fm-unified-header-meta")?.textContent.includes("12/10/2026"),
  null,{timeout:8000});
 await verifyPeriod("day");
 const current=totals().at(-1).query;
 if(current.desde!=="2026-10-05"||current.hasta!=="2026-10-12")
  throw Error("Fechas personalizadas incorrectas");
 noHeavyDetails();
 const beforeFocus=requests.length,beforeTotals=totals().length;
 await page.evaluate(()=>{
  document.dispatchEvent(new Event("visibilitychange"));
  window.dispatchEvent(new Event("focus"));
 });
 await page.waitForTimeout(500);
 if(requests.length!==beforeFocus||totals().length!==beforeTotals)
  throw Error("El foco no debe volver a lanzar las consultas de Ventas");
 await page.getByRole("button",{name:"Actualizar",exact:true}).click();
 await page.waitForTimeout(600);
 if(totals().length<=beforeTotals)throw Error("Actualizar debe recargar datos");
 noHeavyDetails();
 console.log("OK Ventas: tres KPI, ticket compartido y farmacias visibles solo al comparar varias");
}finally{await browser.close()}
