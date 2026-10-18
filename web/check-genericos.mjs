import {chromium} from "playwright";
import assert from "node:assert/strict";
const BASE=process.env.RESPONSIVE_BASE_URL||"http://127.0.0.1:4175";
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1280,height:850}});
const user={email:"qa@example.com",role:"superadministrador",name:"QA"};
const modules={promociones:true,ventas:true,dashboard:true,genericos:true};
const pharmacies=[{id:"1",name:"Farmacia Centro",sourceCode:"ABA",active:true}];
const context={user,client:{slug:"ampedia",name:"Ampedia",schema:"ampedia"},
 clients:[{slug:"ampedia",name:"Ampedia"}],pharmacies,modules,role:"superadministrador"};
let headerSeen=false;
await page.route("**/api/**",async route=>{
 const req=route.request(),u=new URL(req.url()),p=u.pathname;
 let data={};
 if(p==="/api/auth/me")data={user};
 else if(p==="/api/tenant/context")data=context;
 else if(p==="/api/tenant/promociones")data={promotions:[]};
 else if(p==="/api/tenant/farmacias")data=pharmacies;
 else if(p==="/api/genericos/conjuntos"){
  await new Promise(resolve=>setTimeout(resolve,650));
  data={version:{sha256:"aa",fecha_fuente:"2026-10-18",importado_en:"2026-10-18",total_genericos:6000},
    totalGroups:1,summary:{salesUnits:22,revenue:240,purchases:118},
    groups:[{dcpf:"123456789",principle:"Omeprazol",name:"Omeprazol 20 mg 28 cápsulas",
      skuCount:2,genericCount:2,salesUnits:22,revenue:240,
      purchaseUnits:12,spent:118,averagePuc:9.84,bestPuc:8.2,indicativeSavings:19.68}],
    sales:{available:true},purchases:{available:true}};
 }
 else if(p==="/api/genericos/conjuntos/123456789"){
  headerSeen=req.headers()["x-farmetrica-cliente"]==="ampedia";
  data={products:[{cn:"654321",nombre:"Omeprazol A 20 mg",laboratorio:"Lab A",generico:true},
     {cn:"654322",nombre:"Omeprazol B 20 mg",laboratorio:"Lab B",generico:true}],
   sales:[{cn:"654321",units:22,revenue:240}],
   purchases:[{cn:"654321",supplierCode:"P1",supplier:"Proveedor A",units:12,spend:118,puc:9.84}],
   salesAvailable:true,purchasesAvailable:true};
 }
 else if(p==="/api/ventas/seguimiento")data={sales:{}};
 await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(data)});
});
try{
 await page.goto(BASE+"/genericos",{waitUntil:"domcontentloaded"});
 await page.getByRole("heading",{name:"Genéricos",exact:true}).waitFor();
 await page.waitForFunction(()=>document.querySelectorAll(".fm-generic-metric .fm-kpi-spinner").length===4,
  {timeout:7000});
 assert.equal(await page.locator(".fm-generic-chart .fm-loading-panel").count(),1);
 assert.equal(await page.locator(".fm-generic-list .fm-loading-panel").count(),1);
 await page.getByText("Omeprazol",{exact:true}).first().waitFor({timeout:10000});
 await page.getByRole("button",{name:"Desplegar conjunto 123456789"}).click();
 await page.getByText("Proveedor A").first().waitFor();
 assert.equal(headerSeen,true,"Detalle debe mantener tenant explícito");
 assert.equal(await page.locator(".fm-generic-detail .fm-generic-code").count()>0,true);
 console.log("OK: Genéricos carga por visual, muestra agrupación DCPF y desglose aislado por cliente");
}finally{await browser.close();}
