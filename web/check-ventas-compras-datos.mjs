import {chromium} from "playwright";
import assert from "node:assert/strict";
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1180,height:780}});
const user={email:"qa@example.com",role:"superadministrador",name:"QA"};
const pharmacies=[{id:"1",name:"Farmacia Centro",sourceCode:"ABA",databaseCode:"ABA",active:true}];
const context={user,client:{slug:"ampedia",name:"Ampedia",schema:"ampedia",analysisMonths:12},
 clients:[{slug:"ampedia",name:"Ampedia"}],pharmacies,
 modules:{dashboard:true,ventas:true,compras:true},role:"superadministrador"};
let purchaseDetailRequest=0,salesDetailRequest=0;
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
 else if(p==="/api/analytics/ventas/familias-ranking")
  data={families:[],totalSales:3000,totalUnits:65,totalLines:1,coveragePct:0};
 else if(p==="/api/analytics/ventas/actividad")
  data={horarios:{total:3000,cells:[{weekday:1,hour:9,sales:3000,lines:1}]},
   vendedores:{total:3000,sellers:[{pharmacyId:"1",name:"Ana",sales:3000,units:65}]}};
 else if(p==="/api/analytics/ventas/ticket-medio-rapido")
  data={tickets:10,pharmacies:[{id:"1",name:"Farmacia Centro",tickets:10}]};
 else if(p==="/api/analytics/ventas/recuento"){
  salesDetailRequest++;
  data={error:"La pantalla de Ventas no debe calcular recuentos"};
 }
 else if(p==="/api/analytics/ventas/detalle"){
  salesDetailRequest++;
  data={error:"La pantalla de Ventas ya no consulta artículos"};
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
 await page.getByText("Ticket medio neto",{exact:true}).waitFor({timeout:15000});
 await page.locator(".fm-demo-graph[aria-busy=false]").waitFor({timeout:15000});
 await page.getByText("Ventas por familias",{exact:true}).waitFor({timeout:12000});
 await page.getByText("300,00", {exact:false}).first().waitFor({timeout:12000});
 assert.equal(salesDetailRequest,0,"Ventas no debe consultar ni referencias ni detalle");
 assert.equal(await page.locator("#fm-sales-articles").count(),0);
 console.log("OK: Compras conserva su detalle y Ventas ofrece visión general y ticket medio");
}finally{await browser.close()}
