// Regresión de Inicio, filtros entre informes y carga progresiva.
// Simula la autenticación pero usa los contratos HTTP de las consultas reales.
import {chromium} from "playwright";
import assert from "node:assert/strict";
const BASE=process.env.RESPONSIVE_BASE_URL||"http://127.0.0.1:4175";
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1100,height:820}});
const user={email:"auditoria@example.invalid",role:"superadministrador",name:"Auditoría funcional"};
const pharmacies=[
 {id:"1",name:"Farmacia Centro",sourceCode:"ABA",databaseCode:"ABA",active:true},
 {id:"2",name:"Farmacia Europa",sourceCode:"EUR",databaseCode:"EUR",active:true}
];
const modules=Object.fromEntries(["dashboard","ventas","compras","stock","proveedores","genericos",
 "reposicion","rentabilidad","acciones","informes","promociones"].map(x=>[x,true]));
const context={user,clients:[{slug:"ampedia",name:"Ampedia"}],
 client:{slug:"ampedia",name:"Ampedia",schema:"ampedia",analysisMonths:12},
 role:"superadministrador",pharmacies,modules};
const requests=[],pageErrors=[];
page.on("pageerror",e=>pageErrors.push(e.message));
await page.route("**/api/**",async route=>{
 const url=new URL(route.request().url()),p=url.pathname;
 requests.push({path:p,query:Object.fromEntries(url.searchParams.entries())});
 const count=Number(url.searchParams.get("farmacias")?.split(",").filter(Boolean).length||2);
 let body={};
 if(p==="/api/auth/me")body={user};
 else if(p==="/api/tenant/context")body=context;
 else if(p==="/api/tenant/promociones")body={promotions:[]};
 else if(p==="/api/tenant/farmacias")body=pharmacies;
 else if(p==="/api/analytics/ventas/totales")body={
  granularity:url.searchParams.get("granularidad")||"month",
  monthly:[{month:"2026-10",ventas:4046412.26/count*count,unidades:1543*count}],
  series:[{bucket:"2026-10",ventas:4046412.26,unidades:1543*count}],
  kpis:{ventas:4046412.26,unidades:1543*count}
 };
 else if(p==="/api/analytics/dashboard/compras"||p==="/api/analytics/compras/resumen")body={
  available:true,kpis:{compras:2696250.36,unidadesCompradas:9823*count,
   recepciones:120,lineasCompra:1304,proveedores:12},
  monthly:[{month:"2026-10",compras:2696250.36,recepciones:120}],
  sourceRows:1304,hasArticleLines:true
 };
 else if(p==="/api/analytics/reportes")body={
  available:true,monthly:[],kpis:{},salesRows:[],buyRows:[],supplierRows:[],
  stockRows:[],replenishmentRows:[],profitRows:[],actions:[],availability:{}
 };
 else if(p==="/api/analytics/ventas/recuento")body={totalProducts:5,totalArticles:4};
 else if(p==="/api/analytics/ventas/detalle")body={products:[],hasMore:false,totalFiltered:0};
 else if(p==="/api/analytics/ventas/familias")body={families:[]};
 else if(p==="/api/analytics/compras/estado")body={hasPurchases:true,pharmacies:[]};
 await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});
});
const by=p=>requests.filter(x=>x.path===p);
try{
 await page.goto(BASE+"/dashboard",{waitUntil:"domcontentloaded"});
 await page.getByRole("heading",{name:"Inicio"}).waitFor({timeout:15000});
 await page.waitForFunction(()=>[...document.querySelectorAll(".fm-demo-kpi strong")]
  .slice(0,2).every(el=>el.textContent?.includes("€")),{timeout:12000});
 assert.equal(by("/api/analytics/reportes").length,0,"Inicio no debe lanzar el informe completo");
 assert.equal(by("/api/analytics/ventas").length,0,"Inicio no debe repetir el detalle pesado");
 assert.ok(by("/api/analytics/ventas/totales").length>0,"Inicio usa ventas documentales reales");
 assert.ok(by("/api/analytics/dashboard/compras").length>0,"Inicio usa recepciones documentales reales");
 assert.equal(await page.locator(".fm-demo-kpi").count(),8);
 const dashboardLabels=await page.locator(".fm-demo-kpi>span").allTextContents();
 assert.deepEqual(dashboardLabels.slice(0,4),["Ventas","Compras","Margen estimado","Margen bruto (%)"]);
 const moneyMetrics=await page.locator(".fm-demo-kpi strong").evaluateAll(els=>els.slice(0,2).map(el=>{
  const css=getComputedStyle(el);return {size:parseFloat(css.fontSize),whiteSpace:css.whiteSpace,
   width:el.clientWidth,scroll:el.scrollWidth,value:el.textContent};
 }));
 for(const m of moneyMetrics){
  assert.ok(m.size>=18,"Importe demasiado pequeño: "+JSON.stringify(m));
  assert.equal(m.whiteSpace,"nowrap","No partir importes");
  assert.ok(m.scroll<=m.width+3,"Importe desborda la tarjeta: "+JSON.stringify(m));
 }
 await page.locator(".fm-unified-filters select").first().selectOption("this_year");
 await page.waitForFunction(()=>document.querySelector(".fm-unified-filters select")?.value==="this_year");
 await page.waitForTimeout(200);
 const dashboardYear=by("/api/analytics/ventas/totales").at(-1)?.query.desde;
 assert.ok(/^\d{4}-01-01$/.test(dashboardYear||""),"Este año debe empezar en enero");
 await page.getByRole("button",{name:/Ventas: abrir Ventas/}).first().click();
 await page.getByRole("heading",{name:"Ventas",exact:true}).waitFor({timeout:12000});
 await page.waitForTimeout(200);
 assert.equal(by("/api/analytics/ventas/totales").at(-1)?.query.desde,dashboardYear,
  "Ventas debe conservar el filtro temporal de Inicio");
 await page.goto(BASE+"/dashboard",{waitUntil:"domcontentloaded"});
 await page.getByRole("button",{name:"Consultar artículos del período"}).click();
 await page.waitForFunction(()=>document.querySelector(".fm-dashboard-lazy-detail")===null,{timeout:12000});
 await page.waitForTimeout(200);
 assert.equal(by("/api/analytics/reportes").length,1,
  "El detalle completo solo debe consultarse tras la petición del usuario");
 assert.deepEqual(pageErrors,[],"No debe haber excepciones de React");
 console.log("OK: Inicio sin bloqueo, KPI legibles, fuentes documentales y filtros compartidos");
}finally{await browser.close();}
