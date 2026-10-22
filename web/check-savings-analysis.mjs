// Auditoría E2E del panel económico: sólo consulta al pulsar y nunca mezcla escenarios.
import {chromium} from "playwright";
import assert from "node:assert/strict";
const BASE=process.env.RESPONSIVE_BASE_URL||"http://127.0.0.1:4175";
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:375,height:800}});
const paths=[];
const user={email:"qa@example.invalid",role:"superadministrador",name:"QA"};
const pharmacies=[{id:"1",name:"Farmacia A",sourceCode:"ABA",databaseCode:"ABA",active:true}];
const modules=Object.fromEntries(["dashboard","ventas","compras","stock","proveedores","genericos",
 "reposicion","rentabilidad","acciones","informes"].map(x=>[x,true]));
page.on("pageerror",err=>console.error("UI_ERROR",err.message));
await page.route("**/api/**",async route=>{
 const url=new URL(route.request().url()),p=url.pathname;paths.push(p);
 let body={};
 if(p==="/api/auth/me")body={user};
 else if(p==="/api/tenant/context")body={user,clients:[{slug:"ampedia",name:"Ampedia"}],
  client:{slug:"ampedia",name:"Ampedia",schema:"ampedia",analysisMonths:12},
  role:"superadministrador",pharmacies,modules};
 else if(p==="/api/tenant/promociones")body={promotions:[]};
 else if(p==="/api/tenant/farmacias")body=pharmacies;
 else if(p==="/api/analytics/ventas/totales")body={kpis:{ventas:3000,unidades:80},monthly:[],series:[]};
 else if(p==="/api/analytics/dashboard/compras")body={available:true,kpis:{compras:1800,unidadesCompradas:20,recepciones:4,lineasCompra:4},monthly:[],hasAmounts:true,hasArticleLines:true,sourceRows:4};
 else if(p==="/api/analytics/dashboard/canales-compra")body={available:true,channels:[]};
 else if(p==="/api/analytics/dashboard/comparador-puc")body={available:true,rows:[],total:0};
 else if(p==="/api/analytics/dashboard/horarios")body={cells:[],total:0};
 else if(p==="/api/analytics/dashboard/vendedores")body={sellers:[],total:0};
 else if(p==="/api/analytics/reportes")body={available:true,kpis:{},monthly:[],salesRows:[],buyRows:[],stockRows:[],availability:{}};
 else if(p==="/api/analytics/ventas/recuento")body={totalProducts:0,totalArticles:0};
 else if(p==="/api/analytics/ventas/detalle")body={products:[],hasMore:false};
 else if(p==="/api/analytics/ahorro/resumen")body={totals:{
  sales:{amount:3000,lines:4,pricedLines:4},purchases:{amount:1800,lines:4,pricedLines:4,
   channels:{cooperativa:{amount:1100},no_cooperativa:{amount:700}}},
  stock:{amount:900,references:12,pricedReferences:12}},warnings:[]};
 else if(p==="/api/analytics/ahorro/precios")body={totals:{observed:250,indicative:275,verified:3,references:4},
  rows:[{fid:"1",article:"ABC",coop_puc:12,other_puc:9,coop_units:40,coop_lines:3,other_lines:4,diff_eur:120}]};
 else if(p==="/api/analytics/ahorro/stock")body={rows:[{pharmacyId:"1",withoutSalesValue:90,excessCapital:100}]};
 await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});
});
try{
 await page.goto(BASE+"/dashboard",{waitUntil:"domcontentloaded"});
 const button=page.getByRole("button",{name:/Calcular ahorro real/});
 await button.waitFor({timeout:12000});
 assert.equal(paths.filter(p=>p.startsWith("/api/analytics/ahorro/")).length,0,"No precargar análisis costoso");
 await button.click();
 await page.getByText("250,00", {exact:false}).first().waitFor({timeout:12000});
 assert.deepEqual(paths.filter(p=>p.startsWith("/api/analytics/ahorro/")).sort(),[
  "/api/analytics/ahorro/precios","/api/analytics/ahorro/resumen","/api/analytics/ahorro/stock"
 ]);
 const analysis=page.locator("section").filter({has:page.getByRole("heading",{name:"Análisis de ahorro con datos reales"})}).last();
 assert.match(await analysis.innerText(),/Diferencial de precios contrastado/);
 assert.match(await analysis.innerText(),/capital|Capital/);
 console.log("OK: análisis económico manual, tres rutas autorizadas y resultados diferenciados");
}finally{await browser.close();}
