// Prueba móvil de publicación futura: admin publica -> empleado ve ->
// admin devuelve a borrador -> empleado ya no la recibe ni visualiza.
import {chromium} from "playwright";
import assert from "node:assert/strict";
import {visiblePromos} from "../api/src/promocionesTenant.js";
const BASE=process.env.RESPONSIVE_BASE_URL||"http://127.0.0.1:4175";
const now=new Date();
const next=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,1));
const year=next.getUTCFullYear(),month=String(next.getUTCMonth()+1).padStart(2,"0");
const start=year+"-"+month+"-01";
const end=new Date(Date.UTC(year,next.getUTCMonth()+1,0)).toISOString().slice(0,10);
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const context=await browser.newContext({viewport:{width:390,height:844},
 deviceScaleFactor:2,isMobile:true,hasTouch:true});
const page=await context.newPage(),errors=[],writes=[];
let role="administrador";
const pharmacy={id:"1",name:"Abadía",sourceCode:"ABA",active:true};
let campaign={id:"FUTURE-P1",name:"Oferta publicada para próximo mes",
 description:"Disponible con antelación",start,end,status:"Borrador",statusSource:"automatic",
 source:"Excel: diciembre.xlsx",durationMode:"dates",cns:["123456"],
 type:"descuento_porcentaje",discountPercent:"20",targets:{"1":12},sales:{}};
page.on("pageerror",e=>errors.push(e.message));
await page.route("**/api/**",async route=>{
 const path=new URL(route.request().url()).pathname,method=route.request().method();
 const user={email:role==="administrador"?"admin@example.invalid":"empleado@example.invalid",
  role,name:"Usuario de prueba"};
 let response={};
 const ctx={role,allowedPharmacyIds:[1],user,
  client:{slug:"ampedia",schema:"ampedia",name:"Ampedia"},
  pharmacies:[pharmacy],modules:{promociones:true,dashboard:true},
  sections:{promociones:true,"seguimiento-global":true,dashboard:true}};
 if(path==="/api/auth/me")response={user};
 else if(path==="/api/tenant/context")response={
  user,client:ctx.client,clients:[{slug:"ampedia",name:"Ampedia"}],
  role,modules:ctx.modules,sections:ctx.sections,pharmacies:[pharmacy],
  allowedPharmacyIds:[1]};
 else if(path==="/api/tenant/farmacias")response=[pharmacy];
 else if(path==="/api/tenant/promociones"){
  response={promotions:visiblePromos([{documento:campaign,creado_por:"admin@example.invalid"}],{
   context:ctx,user}),deletedIds:[]};
 }else if(path==="/api/tenant/promociones/"+campaign.id&&method==="PUT"){
  const body=route.request().postDataJSON();
  writes.push(body.promotion);
  campaign=body.promotion;
  response={id:campaign.id,saved:true};
 }else if(path==="/api/ventas/seguimiento")response={sales:{},totalSales:{}};
 else if(path==="/api/ventas/detalle")response={rows:[],total:0};
 await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(response)});
});
const row=()=>page.locator(".campaign-table tbody tr").filter({hasText:campaign.name});
const load=async()=>{await page.goto(BASE+"/promociones",{waitUntil:"domcontentloaded"});
 await page.getByRole("heading",{name:"Listado de promociones"}).waitFor({timeout:20000});};
try{
 await load();
 await page.getByRole("button",{name:"Ver todos los meses"}).click();
 await row().first().waitFor({timeout:20000});
 assert.match(await row().first().innerText(),/Borrador/);
 await row().first().getByRole("button",{name:"Editar"}).click();
 await page.getByRole("heading",{name:"Editar promoción"}).waitFor({timeout:15000});
 await page.locator(".drawer").getByLabel("Estado").selectOption("Activa");
 await page.getByRole("button",{name:"Guardar cambios"}).click();
 await page.getByRole("heading",{name:"Editar promoción"}).waitFor({state:"detached",timeout:20000});
 assert.equal(writes.length,1);
 assert.equal(campaign.status,"Activa");
 assert.equal(campaign.statusSource,"manual");
 assert.equal(campaign.start,start);
 assert.equal(campaign.end,end);
 // El empleado tiene permisos de lectura, no de edición. Ve la
 // promoción futura SIN seleccionar manualmente el mes siguiente.
 role="farmacia";
 await load();
 await row().first().waitFor({timeout:20000});
 assert.match(await row().first().innerText(),/Activa/);
 assert.equal(await page.getByRole("combobox",{name:"Estado"}).inputValue(),"Activa");
 assert.equal(await page.getByLabel("Seleccionar mes y año de promociones").inputValue(),"");
 assert.equal(await row().first().getByRole("button",{name:"Editar"}).count(),0);
 // Si vuelve a borrador, el servidor jamás la devuelve al empleado.
 role="administrador";
 await load();
 await page.getByRole("button",{name:"Ver todos los meses"}).click();
 await row().first().waitFor({timeout:20000});
 await row().first().getByRole("button",{name:"Editar"}).click();
 await page.locator(".drawer").getByLabel("Estado").selectOption("Borrador");
 await page.getByRole("button",{name:"Guardar cambios"}).click();
 await page.getByRole("heading",{name:"Editar promoción"}).waitFor({state:"detached",timeout:20000});
 assert.equal(campaign.status,"Borrador");
 assert.equal(writes.length,2);
 role="farmacia";
 await load();
 await page.getByText("0 promociones",{exact:false}).first().waitFor({timeout:20000});
 assert.equal(await row().count(),0);
 assert.deepEqual(errors,[]);
 console.log("PUBLICACION_FUTURA_MOVIL_OK: una oferta futura activa es visible para empleado; borrador solo para administración tras guardar y recargar");
}finally{await browser.close();}
