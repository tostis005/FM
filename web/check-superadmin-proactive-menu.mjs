// Regresión: las dos vistas proactivas son enlaces de primer nivel SOLO para superadministrador.
import assert from "node:assert/strict";
import {chromium} from "playwright";

const base=process.env.RESPONSIVE_BASE_URL||"http://127.0.0.1:4175";
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const modules={dashboard:true,stock:true,acciones:true};
const pharmacies=[{id:"1",name:"Farmacia de prueba",active:true,sourceCode:"ABA"}];
async function openAs(role){
 const page=await browser.newPage({viewport:{width:1280,height:850}});
 const user={email:"menu-"+role+"@example.invalid",name:"Prueba menú",role};
 let alertPolls=0;
 await page.route("**/api/**",async route=>{
  const path=new URL(route.request().url()).pathname;
  let data={};
  if(path==="/api/auth/me")data={user};
  else if(path==="/api/tenant/context")data={user,role,client:{
   slug:"ampedia",name:"Ampedia",schema:"ampedia",analysisMonths:12
  },clients:[{slug:"ampedia",name:"Ampedia"}],pharmacies,
   modules,sections:{dashboard:true,stock:true,acciones:true}};
  else if(path==="/api/analytics/gestion-proactiva/alertas"||
   path==="/api/analytics/gestion-proactiva/inmovilizado"){
    const isAlerts=path.endsWith("alertas");
    if(isAlerts)alertPolls++;
    const pending=isAlerts&&alertPolls<3;
    const rows=isAlerts?[]:[
     {pharmacyId:"1",pharmacyName:"Farmacia de prueba",articleId:"R1",
      cn:"123456",name:"Artículo sin venta reciente",stock:8,unitsPeriod:0,
      unitCost:3,capital:24,alertType:"sin_ventas",
      lastSaleDate:"2025-07-12",lastSaleStatus:"found"},
     {pharmacyId:"1",pharmacyName:"Farmacia de prueba",articleId:"R2",
      cn:"654321",name:"Artículo sin historial",stock:2,unitsPeriod:0,
      unitCost:5,capital:10,alertType:"sin_ventas",
      lastSaleDate:null,lastSaleStatus:"not_found"}
    ];
    data={available:true,mode:isAlerts?"alertas":"inmovilizado",
     status:pending?"calculating":"complete",rows,total:rows.length,excluded:[],
     completedSites:pending?0:1,progress:{done:pending?alertPolls:3,total:3},
     summary:{valuedSubtotal:0,valuedCount:0,stockUnits:0,riskCount:0}};
   }
  else if(path==="/api/tenant/promociones")data={promotions:[]};
  await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(data)});
 });
 await page.goto(base+"/dashboard",{waitUntil:"domcontentloaded"});
 await page.locator("#farmetrica-sidebar .side-nav").waitFor({timeout:15000});
 return page;
}
try{
 const superadmin=await openAs("superadministrador");
 const menu=superadmin.getByRole("navigation",{name:"Módulos"});
 const links=menu.locator(".side-nav-parent > button.side-link");
 for(const label of ["Alertas inteligentes","Stock inmovilizado"]){
  const item=menu.getByRole("button",{name:label,exact:true});
  await item.waitFor({state:"visible",timeout:15000});
  assert.equal(await item.count(),1,label+" debe ser entrada principal");
  assert.equal(await item.evaluate(el=>el.parentElement?.classList.contains("side-nav-parent")),true,
   label+" debe estar directamente en el menú principal");
 }
 const order=await links.allTextContents();
 assert.deepEqual(order.slice(0,3).map(s=>s.trim()),
  ["Inicio","Alertas inteligentes","Stock inmovilizado"]);
 await menu.getByRole("button",{name:"Alertas inteligentes",exact:true}).click();
 await superadmin.getByRole("heading",{name:"Alertas inteligentes"}).waitFor({timeout:12000});
 await superadmin.getByText("Calculando por farmacias y períodos").waitFor({timeout:9000});
 await superadmin.getByRole("heading",{name:"Situaciones detectadas"}).waitFor({timeout:9000});
 await superadmin.waitForFunction(()=>!document.querySelector(".fm-proactive-progress"),null,{timeout:9000});
 assert.equal(new URL(superadmin.url()).pathname,"/alertas-inteligentes");
 await menu.getByRole("button",{name:"Stock inmovilizado",exact:true}).click();
 await superadmin.getByRole("heading",{name:"Stock inmovilizado"}).waitFor({timeout:12000});
 await superadmin.getByRole("columnheader",{name:"Última venta"}).waitFor({timeout:12000});
 await superadmin.getByText("12/07/2025", {exact:true}).waitFor({timeout:12000});
 await superadmin.getByText("Sin ventas registradas",{exact:true}).waitFor({timeout:12000});
 assert.equal(new URL(superadmin.url()).pathname,"/stock-inmovilizado");
 await superadmin.close();

 const admin=await openAs("administrador");
 const regularMenu=admin.getByRole("navigation",{name:"Módulos"});
 assert.equal(await regularMenu.getByRole("button",{name:"Alertas inteligentes"}).count(),0);
 assert.equal(await regularMenu.getByRole("button",{name:"Stock inmovilizado"}).count(),0);
 await admin.goto(base+"/stock-inmovilizado",{waitUntil:"domcontentloaded"});
 await admin.waitForURL("**/dashboard",{timeout:12000});
 assert.equal(await admin.getByRole("heading",{name:"Stock inmovilizado"}).count(),0);
 await admin.close();
 console.log("OK: herramientas proactivas en menú principal solo superadmin y rutas bloqueadas a otros roles");
}finally{await browser.close();}
