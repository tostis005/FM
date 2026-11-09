// Regresión de presentación: ritmo temporal, copy HTML, Excel y migas según permisos.
import assert from "node:assert/strict";
import {chromium} from "playwright";
const BASE=process.env.RESPONSIVE_BASE_URL||"http://127.0.0.1:4175";
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1280,height:860},acceptDownloads:true});
const errors=[];
page.on("pageerror",error=>errors.push(error.message));
const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Madrid",day:"2-digit",
 month:"2-digit",year:"numeric"}).formatToParts(new Date());
const d=Object.fromEntries(parts.map(x=>[x.type,x.value]));
const month=d.year+"-"+d.month;
const count=new Date(Date.UTC(Number(d.year),Number(d.month),0)).getUTCDate();
const today=Math.min(Number(d.day),count);
const target=100,soldGreen=Math.ceil(today/count*target);
let role="farmacia";
const pharmacy={id:"1",name:"Abadía",sourceCode:"ABA",active:true};
const base={status:"Activa",start:month+"-01",end:month+"-"+String(count).padStart(2,"0"),
 cns:["123456"],targets:{"1":target},type:"descuento_porcentaje",discountPercent:"20",
 durationMode:"dates",monthlyObjectives:{[month]:{targets:{"1":target}}}};
const promos=[{...base,id:"P-GREEN",name:"Campaña en ritmo"},
 {...base,id:"P-RED",name:"Campaña retrasada",cns:["654321"]}];
await page.route("**/api/**",async route=>{
 const path=new URL(route.request().url()).pathname;
 const user={email:"test@example.invalid",name:"Prueba",role};
 const isAdmin=role==="administrador";
 let response={};
 if(path==="/api/auth/me")response={user};
 else if(path==="/api/tenant/context")response={
  user,role,client:{slug:"ampedia",name:"Ampedia",schema:"ampedia"},
  clients:[{slug:"ampedia",name:"Ampedia"}],modules:{promociones:true,dashboard:isAdmin},
  sections:{dashboard:isAdmin,promociones:isAdmin,"seguimiento-global":true},
  pharmacies:[pharmacy],allowedPharmacyIds:[1]
 };
 else if(path==="/api/tenant/farmacias")response=[pharmacy];
 else if(path==="/api/tenant/promociones")response={promotions:promos,deletedIds:[]};
 else if(path==="/api/ventas/seguimiento"){
  const body=route.request().postDataJSON();
  response={sales:Object.fromEntries(body.promotions.map(p=>[p.id,{"1":
   p.name==="Campaña en ritmo"?soldGreen:0}])),
   totalSales:Object.fromEntries(body.promotions.map(p=>[p.id,{"1":
   p.name==="Campaña en ritmo"?soldGreen:0}]))};
 }
 else if(path==="/api/ventas/detalle")response={rows:[],total:0};
 await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(response)});
});
try{
 const url=BASE+"/promociones/seguimiento?estado=Activa&mes="+month+
  "&ids=P-GREEN,P-RED&farmacias=1";
 await page.goto(url,{waitUntil:"domcontentloaded"});
 const heading=page.getByRole("heading",{name:"Tabla de seguimiento"});
 await heading.waitFor({timeout:20000});
 const table=page.locator(".fm-color-report-scroll table");
 await table.locator("tbody tr").first().waitFor({timeout:15000});
 assert.equal(await table.locator("tbody tr").count(),2);
 assert.equal(await table.locator("thead th").nth(2).innerText(),"Objetivo (uds.)");
 assert.equal(await table.locator("thead th").nth(5).innerText(),"Plazo transcurrido");
 const good=table.locator("tbody tr").filter({hasText:"Campaña en ritmo"});
 const bad=table.locator("tbody tr").filter({hasText:"Campaña retrasada"});
 assert.match(await good.innerText(),/En ritmo/);
 assert.match(await bad.innerText(),/Por debajo del ritmo/);
 assert.match(await good.locator(".fm-color-report-status").getAttribute("class"),/fm-color-success/);
 const trail=page.getByRole("navigation",{name:"Ruta de navegación"});
 assert.deepEqual((await trail.locator("li").allInnerTexts()).map(s=>s.trim()),
  ["Promociones","Seguimiento"]);
 assert.equal(await trail.getByRole("button",{name:"Promociones"}).count(),0);
 assert.equal(await trail.getByRole("button",{name:"Inicio"}).count(),0);
 for(const width of [1280,768,375,320]){
  await page.setViewportSize({width,height:860});
  const layout=await page.evaluate(()=>{
   const card=document.querySelector(".fm-color-report");
   const head=card.querySelector(".fm-color-report-heading h2");
   const first=card.querySelector("thead th:nth-child(3)");
   const value=card.querySelector("tbody td:nth-child(3)");
   const main=document.querySelector(".main-content");
   const r=e=>e.getBoundingClientRect();
   return {overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
    cardWidth:r(card).width,mainWidth:r(main).width,
    cardLeft:r(card).left,headingLeft:r(head).left,tableLeft:r(card.querySelector(".fm-color-report-scroll")).left,
    objectiveHeaderCenter:r(first).left+r(first).width/2,
    objectiveValueCenter:r(value).left+r(value).width/2,
    hasInternalScroll:card.querySelector(".fm-color-report-scroll").scrollWidth>
      card.querySelector(".fm-color-report-scroll").clientWidth};
  });
  assert.ok(layout.overflow<=5,"La página se desborda en "+width+": "+JSON.stringify(layout));
  assert.ok(layout.cardWidth<=layout.mainWidth+3,"La tarjeta debe encajar en el panel");
  assert.ok(Math.abs(layout.objectiveHeaderCenter-layout.objectiveValueCenter)<=3,
   "Objetivo debe centrarse bajo su columna en "+width);
  assert.ok(layout.headingLeft>layout.cardLeft+10&&layout.tableLeft>layout.cardLeft+10,
   "Cabecera y tabla necesitan margen interior en "+width);
  if(width<=375)assert.ok(layout.hasInternalScroll,"La tabla debe desplazarse dentro de la tarjeta");
 }
 await page.setViewportSize({width:1280,height:860});
 await page.evaluate(()=>{
  window.__copiedHtml="";
  Object.defineProperty(navigator,"clipboard",{configurable:true,value:{
   write:async(items)=>{
    window.__copiedHtml=await (await items[0].getType("text/html")).text();
   },
   writeText:async(text)=>{window.__copiedText=text;}
  }});
 });
 await page.getByRole("button",{name:"Copiar para correo"}).click();
 await page.waitForTimeout(300);
 const clipboard=await page.evaluate(()=>({html:window.__copiedHtml,text:window.__copiedText}));
 assert.ok(clipboard.html?.includes("Plazo transcurrido")||
  clipboard.text?.includes("Plazo transcurrido"),
  "La copia para correo incluye avance y tiempo transcurrido");
 if(clipboard.html)assert.match(clipboard.html,/background:#daf3e5/);
 const download=page.waitForEvent("download");
 await page.getByRole("button",{name:"Descargar Excel"}).click();
 assert.match((await download).suggestedFilename(),/seguimiento-objetivos.*xlsx$/);
 role="administrador";
 await page.goto(url,{waitUntil:"domcontentloaded"});
 await page.getByRole("heading",{name:"Tabla de seguimiento"}).waitFor({timeout:20000});
 const nav=page.getByRole("navigation",{name:"Ruta de navegación"});
 assert.deepEqual((await nav.locator("li").allInnerTexts()).map(s=>s.trim()),
  ["Inicio","Promociones","Seguimiento"]);
 assert.equal(await nav.getByRole("button",{name:"Inicio"}).count(),1);
 assert.equal(await nav.getByRole("button",{name:"Promociones"}).count(),1);
 await nav.getByRole("button",{name:"Promociones"}).click();
 await page.waitForURL(/\/promociones\/?$/,{timeout:8000});
 assert.deepEqual(errors,[]);
 console.log("SEGUIMIENTO_PRESENTACION_OK: ritmo temporal, tabla centrada, copia HTML, Excel, navegación por roles y móvil");
}finally{await browser.close();}
