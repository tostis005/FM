// Prueba de carga progresiva real: SUM primero, recuentos y detalle después,
// sin reutilizar resultados entre selecciones ni asumir spinners simultáneos.
import {chromium} from "playwright";
const BASE=process.env.RESPONSIVE_BASE_URL||"http://127.0.0.1:4175";
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1280,height:850}});
const requests=[];
const user={email:"admin@test.example",role:"superadministrador",name:"Administrador"};
const pharmacies=[{id:"1",name:"Farmacia Centro",sourceCode:"ABA",databaseCode:"ABA",active:true}];
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
  const bucket=granularity==="hour"?from+"T12:00":
    granularity==="day"?from:from.slice(0,7);
  body={from,to:url.searchParams.get("hasta"),granularity,
   monthly:[{month:from.slice(0,7),ventas:234.5,unidades:12}],
   series:[{bucket,ventas:234.5,unidades:12}],
   kpis:{ventas:234.5,unidades:12}};
 }
 else if(p==="/api/analytics/ventas/recuento"){
  requests.push({path:p,query:Object.fromEntries(url.searchParams.entries())});
  await delay(1100);
  body={totalProducts:3,totalArticles:2};
 }
 else if(p==="/api/analytics/ventas/detalle"){
  requests.push({path:p,query:Object.fromEntries(url.searchParams.entries())});
  await delay(1450);
  body={products:[{id:"1|123456",pharmacyId:"1",cn:"123456",name:"Artículo",
    units:12,value:234.5,pvp:25,purchaseCost:8,saleUnitPrice:19.54,
    unitMargin:11.54,margin:138.48,abcdClass:"A"}],hasMore:false,page:1};
 }
 else if(p==="/api/analytics/ventas/familias")body={families:[]};
 else if(p==="/api/health/database")body={status:"ok",database:"connected"};
 await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});
});
const totals=()=>requests.filter(r=>r.path==="/api/analytics/ventas/totales");
async function verifyPeriod(expected){
 // El spinner puede ser efímero si React termina la navegación más tarde.
 // Probar el estado estable real y la concurrencia con detalle todavía pendiente.
 await page.waitForFunction(()=>{
   const graph=document.querySelector(".fm-demo-graph");
   const kpi=document.querySelector(".fm-demo-kpi strong");
   return graph?.getAttribute("aria-busy")==="false"&&
     Boolean(kpi&&kpi.textContent?.trim()!=="—");
 },null,{timeout:14000});
 // La cifra y el gráfico ya son visibles mientras el detalle aún se procesa.
 const latest=totals().at(-1);
 if(!latest||latest.query.granularidad!==expected)
  throw Error("Granularidad del SUM incorrecta: "+JSON.stringify(latest));
 const detailLoading=await page.locator(".fm-demo-table .fm-loading-panel").count();
 if(detailLoading!==1)
  throw Error("La tabla debe seguir cargando después de recibir el SUM");
 await page.locator(".fm-demo-table .fm-loading-panel").waitFor({state:"detached",timeout:11000});
 await page.getByText("Artículo",{exact:true}).first().waitFor({state:"visible",timeout:10000});
 const selected=totals().at(-1).query;
 for(const endpoint of ["/api/analytics/ventas/recuento","/api/analytics/ventas/detalle"]){
  const query=requests.filter(r=>r.path===endpoint).at(-1)?.query;
  if(!query||query.desde!==selected.desde||query.hasta!==selected.hasta)
   throw Error("Las fechas de "+endpoint+" no coinciden con el gráfico: "+
    JSON.stringify({summary:selected,query}));
 }
 return totals().length;
}
try{
 await page.goto(BASE+"/ventas",{waitUntil:"domcontentloaded"});
 await page.locator(".fm-demo-kpi").first().waitFor({state:"visible",timeout:15000});
 await verifyPeriod("month");
 if(totals().length!==1)throw Error("Se esperaba una consulta SQL mensual");
 await page.getByRole("button",{name:"Hoy",exact:true}).click();
 await verifyPeriod("hour");
 let t=totals().at(-1).query;
 if(t.desde!==t.hasta)throw Error("Hoy debe solicitar un solo día");
 await page.getByRole("button",{name:"Esta semana",exact:true}).click();
 await verifyPeriod("day");
 await page.locator(".fm-demo-filters select").first().selectOption("custom");
 await page.getByLabel("Ventas desde").fill("2026-10-05");
 await page.getByLabel("Ventas hasta").fill("2026-10-12");
 await page.waitForFunction(()=>document.querySelector(".fm-sales-period-info")?.textContent.includes("12/10/2026"),
  null,{timeout:8000});
 await page.waitForFunction(()=>document.querySelector(".fm-demo-graph .fm-loading-panel")===null,
  null,{timeout:11000});
 await page.locator(".fm-demo-table .fm-loading-panel").waitFor({state:"detached",timeout:11000});
 t=totals().at(-1).query;
 for(const endpoint of ["/api/analytics/ventas/recuento","/api/analytics/ventas/detalle"]){
  const query=requests.filter(r=>r.path===endpoint).at(-1)?.query;
  if(!query||query.desde!==t.desde||query.hasta!==t.hasta)
   throw Error("El período personalizado del detalle difiere del gráfico: "+
    JSON.stringify({summary:t,query,endpoint}));
 }
 if(t.desde!=="2026-10-05"||t.hasta!=="2026-10-12"||t.granularidad!=="day")
  throw Error("Fechas personalizadas incorrectas: "+JSON.stringify(t));
 console.log("OK: SUM visible antes que ABCD, doble carga independiente y períodos reales");
}finally{await browser.close()}
