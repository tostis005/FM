// Regresión: lateral plano, una barra superior por módulo, recarga y móvil.
import {chromium} from "playwright";
import assert from "node:assert/strict";
const BASE=process.env.RESPONSIVE_BASE_URL||"http://127.0.0.1:4175";
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1280,height:850}});
const user={email:"menu@example.invalid",name:"Test navegación",role:"superadministrador"};
const pharmacies=[{id:"1",name:"Farmacia de prueba",active:true,sourceCode:"ABA"}];
const modules=Object.fromEntries([
 "dashboard","ventas","compras","stock","proveedores","genericos",
 "rentabilidad","promociones","acciones","reposicion","informes"
].map(key=>[key,true]));
await page.route("**/api/**",async route=>{
 const path=new URL(route.request().url()).pathname;
 let body={};
 if(path==="/api/auth/me")body={user};
 else if(path==="/api/tenant/context")body={
  user,client:{slug:"ampedia",name:"Ampedia",schema:"ampedia"},
  clients:[{slug:"ampedia",name:"Ampedia"}],
  pharmacies,role:"superadministrador",modules
 };
 else if(path==="/api/tenant/promociones")body={promotions:[]};
 else if(path==="/api/tenant/farmacias")body=pharmacies;
 else if(path==="/api/analytics/pantallas/stock-historico")body={
  section:"stock-historico",available:true,total:1,page:1,pageSize:25,
  summary:{value:3,units:10,other:7},rows:[
   {at:"2026-10-17",pharmacyId:"1",pharmacyName:"Farmacia de prueba",
    soldUnits:3,receivedUnits:10,documentedNetUnits:7,tickets:2,receipts:1}
  ]
 };
 await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});
});
try{
 await page.goto(BASE+"/dashboard",{waitUntil:"domcontentloaded"});
 await page.locator("#farmetrica-sidebar .side-nav").waitFor({state:"visible",timeout:15000});
 const sidebarStructure=await page.locator("#farmetrica-sidebar").evaluate(aside=>{
  const menu=aside.querySelector(".side-nav"),top=aside.querySelector(".fm-sidebar-top");
  const footer=aside.querySelector(".fm-sidebar-footer"),button=footer.querySelector("button");
  return {
   overflow:getComputedStyle(aside).overflowY,
   menuOverflow:getComputedStyle(menu).overflowY,
   rightPadding:parseFloat(getComputedStyle(aside).paddingRight),
   logoInPanel:top.parentElement===aside,footerInPanel:footer.parentElement===aside,
   toggleLabel:button.textContent.trim(),
   toggleIconCount:button.querySelectorAll("svg").length,
   toggleRightGap:Math.round(aside.getBoundingClientRect().right-button.getBoundingClientRect().right),
   bottomGap:Math.round(aside.getBoundingClientRect().bottom-button.getBoundingClientRect().bottom),
   scrollable:aside.scrollHeight>aside.clientHeight
  };
 });
 assert.equal(sidebarStructure.overflow,"auto","La barra debe pertenecer a todo el panel");
 assert.equal(sidebarStructure.menuOverflow,"visible","La navegación no debe tener scroll independiente");
 assert.equal(sidebarStructure.rightPadding,0,"La barra debe quedar junto a la divisoria derecha");
 assert.ok(sidebarStructure.logoInPanel&&sidebarStructure.footerInPanel);
 assert.equal(sidebarStructure.toggleLabel,"","El plegado no debe mostrar texto");
 assert.equal(sidebarStructure.toggleIconCount,1,"El control debe tener solo un icono");
 assert.ok(sidebarStructure.toggleRightGap>=0&&sidebarStructure.toggleRightGap<=32,
  "El icono debe quedar pegado al borde derecho: "+JSON.stringify(sidebarStructure));
 if(!sidebarStructure.scrollable){
  assert.ok(sidebarStructure.bottomGap>=0&&sidebarStructure.bottomGap<=42,
   "El icono debe quedar abajo: "+JSON.stringify(sidebarStructure));
 }
 await page.getByRole("button",{name:"Plegar menú lateral"}).click();
 assert.equal(await page.locator("#farmetrica-sidebar .brand-mark").isVisible(),true,
  "El isotipo debe permanecer visible al plegar el lateral");
 const collapsedToggle=await page.getByRole("button",{name:"Desplegar menú lateral"}).evaluate(button=>({
  text:button.textContent.trim(),rightGap:Math.round(button.closest(".sidebar").getBoundingClientRect().right-button.getBoundingClientRect().right)
 }));
 assert.equal(collapsedToggle.text,"");
 assert.ok(collapsedToggle.rightGap>=0&&collapsedToggle.rightGap<=32);
 await page.getByRole("button",{name:"Desplegar menú lateral"}).click();
 const menu=page.getByRole("navigation",{name:"Módulos"});
 assert.equal(await menu.locator(".side-nav-caret,.side-nav-submenu,.side-settings-children").count(),0);
 for(const label of ["Ventas","Compras","Stock","Promociones","Configuración","Administración"])
  assert.equal(await menu.getByRole("button",{name:label,exact:true}).count(),1);
 await menu.getByRole("button",{name:"Compras",exact:true}).click();
 const purchase=page.getByRole("navigation",{name:"Vistas de Compras"});
 await purchase.getByRole("link",{name:"Preparador de pedidos",exact:true}).click();
 assert.equal(new URL(page.url()).pathname,"/compras-preparador");
 assert.equal(await menu.getByRole("button",{name:"Preparador de pedidos",exact:true}).count(),0);
 await page.reload({waitUntil:"domcontentloaded"});
 await purchase.getByRole("link",{name:"Preparador de pedidos",exact:true}).waitFor({timeout:15000});
 assert.equal(await purchase.getByRole("link",{name:"Preparador de pedidos",exact:true}).getAttribute("aria-current"),"page");
 await menu.getByRole("button",{name:"Ventas",exact:true}).click();
 const sales=page.getByRole("navigation",{name:"Vistas de Ventas"});
 assert.deepEqual(await sales.getByRole("link").allTextContents(),["Resumen de ventas","Tickets","Devoluciones y anulaciones","Análisis por laboratorio"]);
 await sales.getByRole("link",{name:"Análisis por laboratorio"}).click();
 await page.waitForURL("**/ventas-laboratorios");
 await page.getByRole("heading",{name:"Análisis por laboratorio",exact:true}).first().waitFor({timeout:15000});
 assert.equal(await page.locator(".fm-sl-tabs,.fm-generics-view-switch").count(),0);
 await page.reload({waitUntil:"domcontentloaded"});
 await sales.getByRole("link",{name:"Análisis por laboratorio"}).waitFor({timeout:15000});
 assert.equal(await sales.getByRole("link",{name:"Análisis por laboratorio"}).getAttribute("aria-current"),"page");
 await page.goto(BASE+"/promociones",{waitUntil:"domcontentloaded"});
 const promos=page.getByRole("navigation",{name:"Vistas de Promociones"});
 await promos.getByRole("link",{name:"Seguimiento",exact:true}).waitFor();
 await page.setViewportSize({width:390,height:780});
 await page.getByRole("button",{name:"Abrir menú"}).click();
 await menu.getByRole("button",{name:"Promociones",exact:true}).waitFor({state:"visible"});
 assert.equal(await menu.locator(".side-nav-caret,.side-nav-submenu").count(),0);
 await menu.getByRole("button",{name:"Promociones",exact:true}).click();
 await promos.getByRole("link",{name:"Seguimiento",exact:true}).waitFor({state:"visible"});
 const overflow=await promos.evaluate(el=>({right:el.getBoundingClientRect().right,width:innerWidth}));
 assert.ok(overflow.right<=overflow.width+1,"la barra superior no puede desbordar el móvil");
 // La última pantalla que mostraba «Demo» está sustituida por una consulta
 // documental. Su subtítulo no confunde flujos con saldos de inventario.
 await page.goto(BASE+"/stock-historico",{waitUntil:"domcontentloaded"});
 await page.getByRole("heading",{name:"Histórico de stock",exact:true}).waitFor({timeout:15000});
 await page.locator(".fm-real-screen-table tbody tr").waitFor({state:"visible",timeout:15000});
 assert.equal(await page.locator(".fm-real-screen-table tbody tr").count(),1);
 assert.equal(await page.locator(".side-preview-badge").count(),0,
  "No deben quedar secciones de ejemplo en la navegación principal");
 assert.equal(await page.getByText("Pantalla de demostración").count(),0);
 await page.getByText(/No representa el stock histórico/).waitFor({timeout:5000});
 console.log("OK: menú lateral plano, pestañas superiores, rutas antiguas, recarga y móvil");
}finally{await browser.close();}
