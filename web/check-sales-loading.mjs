// Regresión de la experiencia tipo Power BI: cada visual tiene spinner propio
// y los períodos rápidos cambian las fechas/granularidad de las ventas reales.
import {chromium} from "playwright";
const BASE=process.env.RESPONSIVE_BASE_URL||"http://127.0.0.1:4175";
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1280,height:850}});
const requests=[];
const user={email:"admin@test.example",role:"superadministrador",name:"Administrador"};
const pharmacies=[{id:"1",name:"Farmacia Centro",sourceCode:"ABA",active:true}];
const modules=Object.fromEntries(["dashboard","ventas","promociones"].map(x=>[x,true]));
const context={user,clients:[{slug:"ampedia",name:"Ampedia"}],
 client:{slug:"ampedia",name:"Ampedia",schema:"ampedia"},role:"superadministrador",
 pharmacies,modules};
await page.route("**/api/**",async route=>{
 const url=new URL(route.request().url()),p=url.pathname;
 let body={};
 if(p==="/api/auth/me")body={user};
 else if(p==="/api/tenant/context")body=context;
 else if(p==="/api/tenant/promociones")body={promotions:[]};
 else if(p==="/api/tenant/farmacias")body=pharmacies;
 else if(p==="/api/analytics/ventas"){
  requests.push(Object.fromEntries(url.searchParams.entries()));
  await new Promise(done=>setTimeout(done,900));
  const granularity=url.searchParams.get("granularidad")||"month";
  const bucket=granularity==="hour"?url.searchParams.get("desde")+"T12:00":
    granularity==="day"?url.searchParams.get("desde"):url.searchParams.get("desde").slice(0,7);
  body={monthly:[{month:url.searchParams.get("desde").slice(0,7),ventas:234.5,unidades:12}],
   series:[{bucket,ventas:234.5,unidades:12}],granularity,
   products:[{pharmacyId:"1",cn:"123456",name:"Artículo",units:12,value:234.5}],
   totalArticles:1,totalProducts:1};
 }
 else if(p==="/api/ventas/seguimiento")body={sales:{}};
 else if(p==="/api/health/database")body={status:"ok",database:"connected"};
 await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});
});
try{
 await page.goto(BASE+"/ventas",{waitUntil:"domcontentloaded"});
 await page.locator(".fm-demo-kpi").first().waitFor({state:"visible",timeout:15000});
 const verifyLoading=async()=>{
  await page.waitForFunction(()=>document.querySelectorAll(".fm-demo-kpi .fm-kpi-spinner").length===4,{timeout:4000});
  if(await page.locator(".fm-demo-graph .fm-loading-panel").count()!==1)
    throw Error("El gráfico no tiene cargador propio");
  if(await page.locator(".fm-demo-table .fm-loading-panel").count()!==1)
    throw Error("La tabla no tiene cargador propio");
 };
 await verifyLoading();
 await page.locator(".fm-demo-kpi .fm-kpi-spinner").first().waitFor({state:"detached",timeout:12000});
 if(await page.locator(".fm-demo-kpi").first().locator("strong").count()!==1)
  throw Error("Los indicadores no se recuperan después de la carga");
 await page.getByRole("button",{name:"Hoy",exact:true}).click();
 await verifyLoading();
 await page.locator(".fm-demo-kpi .fm-kpi-spinner").first().waitFor({state:"detached",timeout:12000});
 const today=requests.at(-1);
 if(today.granularidad!=="hour"||today.desde!==today.hasta)
  throw Error("Hoy no agrupa por horas o no filtra un día: "+JSON.stringify(today));
 await page.getByRole("button",{name:"Esta semana",exact:true}).click();
 await verifyLoading();
 await page.locator(".fm-demo-kpi .fm-kpi-spinner").first().waitFor({state:"detached",timeout:12000});
 if(requests.at(-1).granularidad!=="day")
  throw Error("Esta semana debe mostrar agregados diarios");
 await page.locator(".fm-demo-filters select").first().selectOption("custom");
 await page.getByLabel("Ventas desde").fill("2026-10-05");
 await page.getByLabel("Ventas hasta").fill("2026-10-12");
 await page.waitForFunction(()=>document.querySelectorAll(".fm-demo-kpi .fm-kpi-spinner").length===0&&
  [...document.querySelectorAll(".fm-sales-period-info")].some(n=>n.textContent.includes("2026-10-12")),{timeout:16000});
 const custom=requests.at(-1);
 if(custom.desde!=="2026-10-05"||custom.hasta!=="2026-10-12"||custom.granularidad!=="day")
  throw Error("Personalizado no propaga fechas al backend: "+JSON.stringify(custom));
 console.log("OK: spinners independientes, período Hoy, Esta semana y fechas personalizadas");
}finally{await browser.close()}
