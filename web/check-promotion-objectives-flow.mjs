// Recorrido móvil: el guardado de meses existentes es inline, sin abrir el
// formulario lateral; la simulación sí permite crear una nueva campaña.
import {chromium} from "playwright";
import assert from "node:assert/strict";
const BASE=process.env.RESPONSIVE_BASE_URL||"http://127.0.0.1:4175";
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const context=await browser.newContext({viewport:{width:390,height:844},
 deviceScaleFactor:2,isMobile:true,hasTouch:true});
const page=await context.newPage();
const errors=[],writes=[],created=[];
const pharmacy={id:"1",name:"Abadía",sourceCode:"ABA",active:true};
const user={email:"admin@example.invalid",role:"superadministrador",name:"Administrador"};
let campaign={id:"X-NOV-1",name:"Gama nueva · 20% DTO",laboratory:"LAB",
 subtitle:"LAB",range:"Gama nueva",originalOffer:"20% DTO",description:"Oferta",
 source:"Excel: NOVIEMBRE 2026 PROMOCIONES FARMACIA ABADIA Y PB (3).xlsx",
 sourceSheet:"RESUMEN PROMOS",sourceRow:2,start:"2026-11-01",end:"2026-12-15",
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
 else if(path==="/api/tenant/promociones")response={promotions:[campaign,...created],deletedIds:[]};
 else if(path==="/api/ventas/seguimiento")response={sales:{},totalSales:{}};
 else if(path==="/api/ventas/objetivos/buscar"){
  const body=route.request().postDataJSON();
  response={products:(body.cns||[]).map(cn=>({cn,description:cn==="123456"?"Producto A":"Producto B"})),hasMore:false};
 }
 else if(path==="/api/ventas/objetivos/historico"){
  const body=route.request().postDataJSON();
  response={periods:Object.fromEntries(body.periods.map(p=>[p.id,{"1":14}])),stock:{"1":8},stockMissingPharmacyIds:["1"]};
 }else if(path==="/api/ventas/detalle")response={lines:[],total:0,items:[],rows:[]};
 else if(path.startsWith("/api/tenant/promociones/")&&method==="PUT"){
  const body=route.request().postDataJSON(),next=body.promotion;
  writes.push(next);
  if(next.id===campaign.id)campaign=next;
  else{const previous=created.findIndex(p=>p.id===next.id);if(previous>=0)created[previous]=next;else created.push(next);}
  response={id:next.id,saved:true};
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
 assert.equal(new URL(page.url()).searchParams.get("promocion"),campaign.id);
 assert.equal(new URL(page.url()).searchParams.get("mes"),"2026-11");
 await page.reload({waitUntil:"domcontentloaded"});
 await page.getByRole("heading",{name:"Asignar objetivos"}).waitFor({timeout:15000});
 assert.equal(new URL(page.url()).searchParams.get("promocion"),campaign.id);
 assert.equal(await page.locator(".fm-objectives-selected").getByText("Producto A").count(),1);
 assert.equal(await page.getByRole("button",{name:/noviembre 2026: Sin objetivos asignados/i}).count(),1);
 assert.equal(await page.getByRole("button",{name:/diciembre 2026: Sin objetivos asignados/i}).count(),1);
 assert.match(await page.locator(".fm-objectives-storage").innerText(),/Sin objetivos guardados/);
 assert.match(await page.locator(".fm-objectives-goal-cell").first().innerText(),/Propuesta/);
 assert.equal(await page.locator(".fm-objectives-month-range").count(),0);
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
 assert.match(await page.locator(".fm-objectives-storage").innerText(),/Cambios sin guardar/);
 assert.match(await page.locator(".fm-objectives-goal-cell").first().innerText(),/Sin guardar/);
 const save=page.getByRole("button",{name:"Guardar objetivos"});
 await save.waitFor({state:"visible"});
 await page.waitForFunction(()=>!document.querySelector('.fm-objectives-create button')?.disabled,
  null,{timeout:20000});
 await save.click();
 await page.getByText("Objetivos de noviembre 2026 guardados correctamente.").waitFor({timeout:20000});
 assert.equal(new URL(page.url()).pathname,"/promociones/nueva",
  "Guardar objetivos existentes mantiene la página de objetivos");
 assert.equal(new URL(page.url()).searchParams.get("promocion"),campaign.id);
 assert.equal(new URL(page.url()).searchParams.get("mes"),"2026-11");
 assert.equal(await page.locator(".drawer").count(),0,"Guardar objetivos no debe abrir el panel lateral");
 assert.equal(writes.length,1);
 assert.equal(writes[0].id,"X-NOV-1");
 assert.equal(writes[0].sourceRow,2);
 assert.deepEqual(writes[0].cns,["123456","654321"]);
 assert.equal(writes[0].targets["1"],25);
 assert.equal(writes[0].status,"Borrador"); // Asignar metas no publica
 assert.equal(await page.getByRole("spinbutton",{name:"Objetivo Abadía"}).inputValue(),"25");
 assert.equal(await page.getByRole("button",{name:/noviembre 2026: Objetivos guardados/i}).count(),1);
 assert.equal(await page.getByRole("button",{name:/diciembre 2026: Sin objetivos asignados/i}).count(),1);
 assert.match(await page.locator(".fm-objectives-storage").innerText(),/Objetivos guardados para noviembre/);
 assert.match(await page.locator(".fm-objectives-goal-cell").first().innerText(),/Guardado/);
 assert.equal(await page.getByRole("button",{name:"Volver a promociones"}).count(),1);
 await page.getByRole("button",{name:/diciembre 2026: Sin objetivos asignados/i}).click();
 assert.equal(new URL(page.url()).searchParams.get("mes"),"2026-12");
 await page.reload({waitUntil:"domcontentloaded"});
 await page.getByRole("button",{name:/diciembre 2026: Sin objetivos asignados/i}).waitFor({timeout:15000});
 assert.equal(new URL(page.url()).searchParams.get("promocion"),campaign.id);
 assert.equal(new URL(page.url()).searchParams.get("mes"),"2026-12");
 await page.getByRole("button",{name:/noviembre 2026: Objetivos guardados/i}).waitFor();
 assert.match(await page.locator(".fm-objectives-storage").innerText(),/Sin objetivos guardados para diciembre/);
 assert.match(await page.locator(".fm-objectives-goal-cell").first().innerText(),/Propuesta/);
 await page.getByRole("spinbutton",{name:"Objetivo Abadía"}).fill("40");
 assert.match(await page.locator(".fm-objectives-storage").innerText(),/Cambios sin guardar/);
 await page.getByRole("button",{name:"Guardar objetivos"}).click();
 await page.getByText("Objetivos de diciembre 2026 guardados correctamente.").waitFor({timeout:20000});
 assert.equal(await page.locator(".drawer").count(),0);
 assert.equal(new URL(page.url()).searchParams.get("mes"),"2026-12");
 assert.equal(writes.length,2);
 assert.equal(writes[1].monthlyObjectives["2026-11"].targets["1"],25);
 assert.equal(writes[1].monthlyObjectives["2026-12"].targets["1"],40);
 assert.equal(await page.getByRole("button",{name:/noviembre 2026: Objetivos guardados/i}).count(),1);
 assert.equal(await page.getByRole("button",{name:/diciembre 2026: Objetivos guardados/i}).count(),1);
 await page.getByRole("button",{name:/noviembre 2026: Objetivos guardados/i}).click();
 assert.equal(await page.getByRole("spinbutton",{name:"Objetivo Abadía"}).inputValue(),"25",
  "Volver a un mes guardado mantiene las unidades manuales anteriores");
 assert.equal(await page.locator(".fm-objectives-save-success").count(),0,
  "La confirmación de diciembre no debe aparecer en noviembre");
 await page.getByRole("button",{name:"Volver a promociones"}).click();
 assert.equal(new URL(page.url()).pathname,"/promociones");
 assert.equal(await page.locator(".drawer").count(),0,
  "Volver al listado tampoco abre el panel de la derecha");
 await page.getByRole("button",{name:"Editar objetivos",exact:true}).click();
 await page.getByRole("button",{name:/noviembre 2026: Objetivos guardados/i}).waitFor({timeout:15000});
 await page.getByRole("button",{name:/noviembre 2026: Objetivos guardados/i}).click();
 await page.waitForFunction(()=>document.querySelector('input[aria-label="Objetivo Abadía"]')?.value==="25",
  null,{timeout:15000});
 assert.equal(await page.getByRole("spinbutton",{name:"Objetivo Abadía"}).inputValue(),"25");
 await page.getByRole("button",{name:"Volver a promociones"}).click();
 await page.reload({waitUntil:"domcontentloaded"});
 await page.getByText("Gama nueva · 20% DTO").first().waitFor({timeout:15000});
 assert.equal(writes.length,2);
 // Simular sin crear campaña no debe guardar ningún objetivo de momento.
 await page.goto(BASE+"/promociones/nueva",{waitUntil:"domcontentloaded"});
 await page.getByRole("heading",{name:"Simulador de ventas y objetivos"}).waitFor({timeout:15000});
 assert.equal(new URL(page.url()).searchParams.has("promocion"),false);
 assert.equal(await page.locator(".fm-objectives-months").count(),0);
 await page.getByRole("tab",{name:"Pegar lista de CN"}).click();
 await page.getByLabel("Pegar códigos nacionales").fill("123456");
 await page.getByRole("button",{name:"Añadir CN"}).click();
 await page.getByText("Productos seleccionados · 1 CN").waitFor({timeout:15000});
 await page.getByRole("radio",{name:"Usar stock actual como base de objetivos"}).check();
 await page.getByRole("spinbutton",{name:"Objetivo Abadía"}).waitFor();
 await page.waitForFunction(()=>document.querySelector('input[aria-label="Objetivo Abadía"]')?.value==="8",
   null,{timeout:15000});
 await page.getByRole("spinbutton",{name:"Objetivo Abadía"}).fill("53");
 assert.equal(writes.length,2,"Simular no debe crear ni modificar campañas");
 await page.getByRole("button",{name:"Crear promoción con esta propuesta"}).click();
 await page.getByRole("heading",{name:"Nueva campaña"}).waitFor({timeout:15000});
 assert.equal(await page.locator(".fm-promotion-proposal-month").count(),0);
 assert.match(await page.locator(".fm-promotion-proposal").innerText(),/Indica las fechas/);
 await page.getByLabel("Nombre de promoción").fill("Promoción desde simulador");
 await page.getByLabel("Fecha de inicio").fill("2026-11-15");
 await page.getByLabel("Fecha de fin").fill("2026-12-15");
 assert.equal(await page.locator('input[name="proposal-objective-month"]').count(),2);
 assert.equal(await page.locator('input[name="proposal-objective-month"]:checked').count(),0);
 await page.getByRole("button",{name:"Crear campaña"}).click();
 assert.equal(writes.length,2,"No debe guardar una propuesta de dos meses sin elegir mes");
 assert.match(await page.getByRole("alert").last().innerText(),/Selecciona a qué mes/);
 await page.locator('input[name="proposal-objective-month"][value="2026-12"]').check();
 assert.equal(await page.getByRole("spinbutton",{name:"Objetivo Abadía"}).inputValue(),"53");
 await page.getByRole("button",{name:"Crear campaña"}).click();
 await page.getByRole("heading",{name:"Nueva campaña"}).waitFor({state:"hidden",timeout:15000});
 assert.equal(writes.length,3);
 const added=created[0];
 assert.equal(added.name,"Promoción desde simulador");
 assert.equal(added.start,"2026-11-15");assert.equal(added.end,"2026-12-15");
 assert.deepEqual(added.monthlyObjectives["2026-12"].targets,{"1":53});
 assert.equal(added.monthlyObjectives["2026-11"],undefined);
 assert.equal(added.targets["1"],53);
 assert.equal(added.objectiveBaseline,"stock");
 await page.goto(BASE+"/promociones/nueva?promocion="+encodeURIComponent(added.id)+"&mes=2026-12",
  {waitUntil:"domcontentloaded"});
 await page.getByRole("heading",{name:"Asignar objetivos"}).waitFor({timeout:15000});
 assert.equal(await page.getByRole("spinbutton",{name:"Objetivo Abadía"}).inputValue(),"53");
 assert.equal(await page.getByRole("button",{name:/diciembre 2026: Objetivos guardados/i}).count(),1);
 assert.equal(await page.getByRole("button",{name:/noviembre 2026: Sin objetivos asignados/i}).count(),1);
 assert.deepEqual(errors,[]);
 console.log("OBJETIVOS_MÓVIL_OK: guardado mensual inline sin drawer, confirmación, vuelta al listado, simulación y URL persistente");
}finally{await browser.close();}
