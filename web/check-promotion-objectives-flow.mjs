// Recorrido real del navegador móvil: lista -> planificador -> guardar en
// la misma promoción -> formulario derecho -> planificador -> volver.
import {chromium} from "playwright";
import assert from "node:assert/strict";
const BASE=process.env.RESPONSIVE_BASE_URL||"http://127.0.0.1:4175";
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const context=await browser.newContext({viewport:{width:390,height:844},
 deviceScaleFactor:2,isMobile:true,hasTouch:true});
const page=await context.newPage();
const errors=[],writes=[];
const pharmacy={id:"1",name:"Abadía",sourceCode:"ABA",active:true};
const user={email:"admin@example.invalid",role:"superadministrador",name:"Administrador"};
let campaign={id:"X-NOV-1",name:"Gama nueva · 20% DTO",laboratory:"LAB",
 subtitle:"LAB",range:"Gama nueva",originalOffer:"20% DTO",description:"Oferta",
 source:"Excel: NOVIEMBRE 2026 PROMOCIONES FARMACIA ABADIA Y PB (3).xlsx",
 sourceSheet:"RESUMEN PROMOS",sourceRow:2,start:"2026-11-01",end:"2026-11-30",
 durationMode:"dates",status:"Borrador",statusSource:"automatic",
 cns:["123456","654321"],cnDescriptions:{"123456":"Producto A","654321":"Producto B"},
 targets:{},sales:{},type:"descuento_porcentaje",discountPercent:"20"};
page.on("pageerror",e=>errors.push(e.message));
await page.route("**/api/**",async route=>{
 const path=new URL(route.request().url()).pathname,method=route.request().method();
 let response={},status=200;
 if(path==="/api/auth/me")response={user};
 else if(path==="/api/tenant/context")response={
  user,client:{slug:"ampedia",name:"Ampedia",schema:"ampedia"},
  clients:[{slug:"ampedia",name:"Ampedia"}],role:"superadministrador",
  modules:{promociones:true},pharmacies:[pharmacy],allowedPharmacyIds:[1]};
 else if(path==="/api/tenant/farmacias")response=[pharmacy];
 else if(path==="/api/tenant/promociones")response={promotions:[campaign],deletedIds:[]};
 else if(path==="/api/ventas/seguimiento")response={sales:{},totalSales:{}};
 else if(path==="/api/ventas/objetivos/historico"){
  const body=route.request().postDataJSON();
  response={periods:Object.fromEntries(body.periods.map(p=>[p.id,{"1":14}])),stock:{"1":8},stockMissingPharmacyIds:["1"]};
 }else if(path==="/api/ventas/detalle")response={lines:[],total:0,items:[],rows:[]};
 else if(path==="/api/tenant/promociones/"+campaign.id&&method==="PUT"){
  const body=route.request().postDataJSON();
  writes.push(body.promotion);campaign=body.promotion;response={id:campaign.id,saved:true};
 }
 await route.fulfill({status,contentType:"application/json",body:JSON.stringify(response)});
});
try{
 await page.goto(BASE+"/promociones",{waitUntil:"domcontentloaded"});
 await page.getByRole("button",{name:"Asignar objetivos",exact:true}).waitFor({timeout:15000});
 assert.equal(await page.getByRole("combobox",{name:"Estado"}).inputValue(),"Todos");
 assert.equal(await page.getByLabel("Seleccionar mes y año de promociones").inputValue(),"2026-11");
 await page.getByRole("button",{name:"Asignar objetivos",exact:true}).click();
 await page.getByRole("heading",{name:"Asignar objetivos"}).waitFor({timeout:15000});
 assert.equal(new URL(page.url()).pathname,"/promociones/nueva");
 assert.match(await page.locator(".fm-objectives-selected").innerText(),/2 CN/);
 assert.match(await page.locator(".fm-objectives-selected").innerText(),/Producto A/);
 // Un CN sin stock registrado NO debe poner objetivo 0 cuando los demás suman 8.
 await page.getByRole("radio",{name:"Usar stock actual como base de objetivos"}).check();
 await page.getByRole("spinbutton",{name:"Objetivo Abadía"}).waitFor();
 await page.waitForFunction(()=>document.querySelector('input[aria-label="Objetivo Abadía"]')?.value==="8",
   null,{timeout:15000});
 assert.equal(await page.getByRole("spinbutton",{name:"Objetivo Abadía"}).inputValue(),"8");
 assert.equal(await page.locator(".fm-objectives-table").getByText("Parcial").count(),0);
 await page.getByRole("spinbutton",{name:"Objetivo Abadía"}).fill("25");
 const save=page.getByRole("button",{name:"Guardar objetivos"});
 await save.waitFor({state:"visible"});
 await page.waitForFunction(()=>!document.querySelector('.fm-objectives-create button')?.disabled,
  null,{timeout:20000});
 await save.click();
 await page.getByRole("heading",{name:"Editar promoción"}).waitFor({timeout:20000});
 assert.equal(new URL(page.url()).pathname,"/promociones");
 assert.equal(writes.length,1);
 assert.equal(writes[0].id,"X-NOV-1");
 assert.equal(writes[0].sourceRow,2);
 assert.deepEqual(writes[0].cns,["123456","654321"]);
 assert.equal(writes[0].targets["1"],25);
 assert.equal(writes[0].status,"Borrador"); // Asignar metas no publica
 assert.equal(await page.getByRole("spinbutton",{name:"Objetivo Abadía"}).inputValue(),"25");
 await page.getByRole("button",{name:"Asignar objetivos con ventas históricas y stock"}).click();
 await page.getByRole("heading",{name:"Asignar objetivos"}).waitFor({timeout:15000});
 assert.equal(await page.getByRole("spinbutton",{name:"Objetivo Abadía"}).inputValue(),"25");
 await page.getByRole("button",{name:"Volver al formulario"}).click();
 await page.getByRole("heading",{name:"Editar promoción"}).waitFor({timeout:15000});
 assert.equal(await page.getByRole("spinbutton",{name:"Objetivo Abadía"}).inputValue(),"25");
 await page.reload({waitUntil:"domcontentloaded"});
 await page.getByText("Gama nueva · 20% DTO").first().waitFor({timeout:15000});
 assert.equal(writes.length,1);
 assert.deepEqual(errors,[]);
 console.log("OBJETIVOS_MÓVIL_OK: precarga de CN, guardado en la misma promoción, retorno al formulario y recarga");
}finally{await browser.close();}
