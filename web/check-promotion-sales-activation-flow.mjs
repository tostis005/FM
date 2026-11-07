// Navegador móvil: borrador sin objetivos -> ventas reales totales ->
// asignar metas -> activar -> guardar -> recargar -> seguimiento.
import {chromium} from "playwright";
import assert from "node:assert/strict";
const BASE=process.env.RESPONSIVE_BASE_URL||"http://127.0.0.1:4175";
const today=new Date(),year=today.getUTCFullYear(),month=today.getUTCMonth();
const first=new Date(Date.UTC(year,month,1)).toISOString().slice(0,10);
const last=new Date(Date.UTC(year,month+1,0)).toISOString().slice(0,10);
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const context=await browser.newContext({viewport:{width:390,height:844},
 deviceScaleFactor:2,isMobile:true,hasTouch:true});
const page=await context.newPage(),errors=[],writes=[],requests=[];
const user={email:"admin@example.invalid",role:"superadministrador",name:"Administrador"};
const pharmacies=[{id:"1",name:"Abadía",sourceCode:"ABA",active:true},
 {id:"2",name:"Europa",sourceCode:"EUR",active:true}];
let campaign={id:"NOV-DRAFT-TEST",name:"Promoción de prueba ventas de CN",
 source:"Excel: PROMOCIONES.xlsx",type:"dos_por_uno",description:"Dos por uno",
 cns:["123456","654321"],cnDescriptions:{"123456":"Producto A","654321":"Producto B"},
 durationMode:"dates",start:first,end:last,status:"Borrador",
 statusSource:"manual",targets:{},sales:{}};
page.on("pageerror",e=>errors.push(e.message));
await page.route("**/api/**",async route=>{
 const path=new URL(route.request().url()).pathname,method=route.request().method();
 let response={};
 if(path==="/api/auth/me")response={user};
 else if(path==="/api/tenant/context")response={
  user,client:{slug:"ampedia",name:"Ampedia",schema:"ampedia"},
  clients:[{slug:"ampedia",name:"Ampedia"}],role:"superadministrador",
  modules:{promociones:true},pharmacies,allowedPharmacyIds:[1,2]};
 else if(path==="/api/tenant/farmacias")response=pharmacies;
 else if(path==="/api/tenant/promociones")response={promotions:[campaign],deletedIds:[]};
 else if(path==="/api/ventas/seguimiento"){
  const body=route.request().postDataJSON();
  requests.push(body.promotions);
  const sales={},totalSales={};
  for(const p of body.promotions){
   sales[p.id]={"1":0,"2":0};
   totalSales[p.id]={"1":13,"2":9};
  }
  response={sales,totalSales,origin:"ampedia.fm_ventas_analitica"};
 }else if(path==="/api/ventas/objetivos/historico"){
  const body=route.request().postDataJSON();
  response={periods:Object.fromEntries(body.periods.map(p=>[p.id,{"1":3,"2":1}])),
   stock:{"1":8,"2":2},amounts:{}};
 }else if(path==="/api/ventas/detalle")response={rows:[],total:0};
 else if(path==="/api/tenant/promociones/"+campaign.id&&method==="PUT"){
  const body=route.request().postDataJSON();
  writes.push(body.promotion);
  campaign=body.promotion;
  response={id:campaign.id,saved:true};
 }
 await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(response)});
});
const row=()=>page.locator(".campaign-table tbody tr").filter({hasText:campaign.name}).first();
const waitTotal=async()=>{await page.waitForFunction(name=>{
 const tr=[...document.querySelectorAll(".campaign-table tbody tr")]
  .find(el=>el.textContent.includes(name));
 return tr?.textContent?.includes("22");
},campaign.name,{timeout:25000});};
try{
 await page.goto(BASE+"/promociones",{waitUntil:"domcontentloaded"});
 await row().waitFor({timeout:20000});
 await waitTotal();
 assert.ok(requests.length>0,"Se consultan ventas incluso con targets vacíos");
 assert.equal(campaign.status,"Borrador");
 assert.ok((await row().innerText()).includes("22"),"Las unidades totales son 13 + 9");
 await row().getByRole("button",{name:"Asignar objetivos"}).click();
 await page.getByRole("heading",{name:"Asignar objetivos"}).waitFor({timeout:20000});
 await page.getByRole("spinbutton",{name:"Objetivo Abadía"}).fill("10");
 await page.getByRole("spinbutton",{name:"Objetivo Europa"}).fill("0");
 await page.getByRole("button",{name:"Guardar objetivos"}).click();
 await page.getByRole("heading",{name:"Editar promoción"}).waitFor({timeout:20000});
 assert.equal(writes.length,1);
 assert.equal(writes[0].status,"Borrador");
 assert.deepEqual(writes[0].targets,{"1":10,"2":0});
 await page.locator(".drawer").getByLabel("Estado").selectOption("Activa");
 await page.getByRole("button",{name:"Guardar cambios"}).click();
 await page.getByRole("heading",{name:"Editar promoción"}).waitFor({state:"detached",timeout:20000});
 assert.equal(writes.length,2);
 assert.equal(writes[1].status,"Activa");
 assert.equal(writes[1].statusSource,"manual");
 await waitTotal();
 assert.match(await row().innerText(),/Activa/);
 await page.reload({waitUntil:"domcontentloaded"});
 await row().waitFor({timeout:20000});
 await waitTotal();
 assert.match(await row().innerText(),/Activa/);
 await row().getByRole("button",{name:"Seguimiento"}).click();
 await page.getByText("Uds. totales de CNs").first().waitFor({timeout:20000});
 await page.waitForFunction(()=>document.body.textContent.includes("22"),null,{timeout:20000});
 assert.equal(errors.length,0,errors.join(" | "));
 console.log("PROMO_E2E_MOBILE_OK: borrador 22 unidades totales, objetivos 10+0, activación manual persistente, 0 por mecánica 2x1 y seguimiento tras recarga");
}finally{await browser.close();}
