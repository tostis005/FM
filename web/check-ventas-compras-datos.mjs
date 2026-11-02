import {chromium} from "playwright";
import assert from "node:assert/strict";
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1180,height:780}});
const user={email:"qa@example.com",role:"superadministrador",name:"QA"};
const pharmacies=[{id:"1",name:"Farmacia Centro",sourceCode:"ABA",databaseCode:"ABA",active:true}];
const context={user,client:{slug:"ampedia",name:"Ampedia",schema:"ampedia",analysisMonths:12},
 clients:[{slug:"ampedia",name:"Ampedia"}],pharmacies,
 modules:{dashboard:true,ventas:true,compras:true},role:"superadministrador"};
let purchaseDetailRequest=0,failedSort=false;
await page.route("**/api/**",async route=>{
 const url=new URL(route.request().url()),p=url.pathname;let data={};
 if(p==="/api/auth/me")data={user};
 else if(p==="/api/tenant/context")data=context;
 else if(p==="/api/tenant/farmacias")data=pharmacies;
 else if(p==="/api/analytics/reportes"){
  purchaseDetailRequest++;
  assert.equal(url.searchParams.get("soloDetalle"),"1");
  await new Promise(r=>setTimeout(r,250));
  data={available:true,kpis:{compras:null},monthly:[],availability:{purchases:true},
   buyRows:[{id:"1|654321|P1",cn:"654321",name:"Ibuprofeno 400 mg 20 comprimidos",
    pharmacyId:"1",supplier:"Laboratorio A",providerId:"P1",units:30,value:1200,puc:40,lines:12}]};
 }else if(p==="/api/analytics/compras/resumen"){
  await new Promise(r=>setTimeout(r,1250));
  data={available:true,kpis:{compras:1200,unidadesCompradas:30,recepciones:9,
   lineasCompra:12,proveedores:1},monthly:[{month:"2026-10",compras:1200}],
   hasArticleLines:true,sourceRows:12,hasAmounts:true,amountCoveragePct:100};
 }else if(p==="/api/analytics/compras/estado")
  data={hasPurchases:true,source:"normalized",pharmacies:[{pharmacyId:"1",hasPeriodPurchases:true}]};
 else if(p==="/api/analytics/ventas/totales")
  data={kpis:{ventas:3000,unidades:65},monthly:[{month:"2026-10",ventas:3000,unidades:65}],
   granularity:"month",series:[{bucket:"2026-10",ventas:3000,unidades:65}]};
 else if(p==="/api/analytics/ventas/recuento")data={totalProducts:2,totalArticles:1};
 else if(p==="/api/analytics/ventas/detalle"){
  await new Promise(r=>setTimeout(r,260));
  if(url.searchParams.get("orden")==="cn"&&!failedSort){
   failedSort=true;await route.fulfill({status:503,contentType:"application/json",
    body:JSON.stringify({error:"Error temporal del listado"})});return;
  }
  data={products:[{id:"1|654321",pharmacyId:"1",cn:"654321",
   name:"Artículo vendido individual",units:65,value:3000,abcdClass:"A"}],
   totalFiltered:1,hasMore:false,page:1};
 }else if(p==="/api/analytics/dashboard/horarios")data={total:0,cells:[]};
 await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(data)});
});
try{
 const base=process.env.RESPONSIVE_BASE_URL||"http://127.0.0.1:4175";
 await page.goto(base+"/compras",{waitUntil:"domcontentloaded"});
 await page.getByText("Ibuprofeno 400 mg 20 comprimidos",{exact:true}).waitFor({timeout:15000});
 assert.ok(purchaseDetailRequest>0);
 await page.waitForFunction(()=>document.querySelector(".fm-demo-table .fm-loading-panel")===null,
  null,{timeout:12000});
 await page.goto(base+"/ventas",{waitUntil:"domcontentloaded"});
 await page.getByText("Artículo vendido individual",{exact:true}).waitFor({timeout:15000});
 await page.getByRole("button",{name:"Ordenar CN"}).first().click();
 await page.getByText("Error temporal del listado").first().waitFor({timeout:12000});
 await page.getByRole("button",{name:"Reintentar consulta"}).click();
 await page.getByText("Artículo vendido individual",{exact:true}).waitFor({timeout:12000});
 await page.waitForFunction(()=>document.querySelector("#fm-sales-articles .fm-loading-panel")===null,
  null,{timeout:12000});
 console.log("OK: Compras muestra referencias independientemente del resumen y Ventas recupera fallos");
}finally{await browser.close()}
