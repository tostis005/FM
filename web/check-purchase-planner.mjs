// Regresión de navegación, filtros y geometría del único preparador vigente.
import {chromium} from "playwright";
import assert from "node:assert/strict";
const BASE=process.env.RESPONSIVE_BASE_URL||"http://127.0.0.1:4175";
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1280,height:850}});
const user={email:"preparador-ci@example.invalid",name:"QA",role:"superadministrador"};
const pharmacies=[{id:"1",name:"Farmacia Centro",sourceCode:"ABA",databaseCode:"ABA"},
 {id:"2",name:"Farmacia Norte",sourceCode:"NOR",databaseCode:"NOR"}];
const context={user,clients:[{slug:"ampedia",name:"Ampedia"}],
 client:{slug:"ampedia",schema:"ampedia",name:"Ampedia"},role:"superadministrador",
 pharmacies,modules:{compras:true,dashboard:true}};
const errors=[],matrices=[],saved=[],stockWrites=[];
page.on("pageerror",e=>errors.push(e.message));
await page.route("**/api/**",async route=>{
 const request=route.request(),url=new URL(request.url()),path=url.pathname;
 let body={};
 if(path==="/api/auth/me")body={user};
 else if(path==="/api/tenant/context")body=context;
 else if(path==="/api/tenant/farmacias")body=pharmacies;
 else if(path==="/api/operativa")body={scope:{canEdit:true,canApprove:true},items:[]};
 else if(path==="/api/analytics/pedidos/proveedores-unificados")
  body={laboratories:[{key:"P:1",name:"Laboratorio Alfa",class:"DIRECTO"}]};
 else if(path==="/api/analytics/pedidos/catalogo-unificado")
  body={total:1,rows:[{referencia:"123456",cn:"123456",
   nombre:"Crema de manos",tipo:"parafarmacia",inReceipts:true}]};
 else if(path==="/api/analytics/pedidos/borrador-laboratorio"){
  if(request.method()==="PUT"){
   saved.push(request.postDataJSON());body={saved:true,count:1,updatedAt:new Date().toISOString()};
  }else body={lineas:[]};
 }else if(path==="/api/analytics/pedidos/matriz-conjunta"||
  path==="/api/analytics/pedidos/matriz-referencias"){
  const input=request.postDataJSON();matrices.push(input);
  body={total:1,frequencyDays:7,rows:input.referencias.map(r=>({...r,
   byPharmacy:{
    "1":{stock:6,unitsPeriod:12,units3:45,units12:150,suggested:3,ordered:0},
    "2":{stock:4,unitsPeriod:12,units3:45,units12:150,suggested:5,ordered:0}
   },totalSold:24,totalSuggested:8
  }))};
 }else if(path==="/api/tenant/stock-objetivo"&&request.method()==="GET")
  body={defaultDays:20,days:20};
 else if(path==="/api/tenant/stock-objetivo"&&request.method()==="PUT"){
  stockWrites.push(request.postDataJSON());
  body={days:stockWrites.at(-1).days};
 }
 await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});
});
try{
 await page.goto(BASE+"/compras-preparador?vista=anterior",{waitUntil:"domcontentloaded"});
 await page.getByRole("combobox",{name:"Seleccionar laboratorio"}).waitFor({timeout:15000});
 assert.equal(await page.locator(".fm-preparador-switch").count(),0,
  "Los botones de versión anterior desaparecen incluso desde un enlace antiguo");
 assert.equal(await page.locator(".fm-laboratory-catalog").count(),0);
 await page.getByRole("combobox",{name:"Seleccionar laboratorio"}).fill("Alfa");
 await page.getByRole("option",{name:"Laboratorio Alfa"}).click();
 await page.getByText("Crema de manos").first().waitFor({timeout:15000});
 assert.equal(await page.locator(".fm-lab-order-tabs .btn").count(),2);
 assert.equal(await page.locator(".fm-lab-order-tabs .btn-primary").count(),1);
 assert.equal(await page.getByLabel("Desde",{exact:true}).count(),1);
 assert.equal(await page.getByLabel("Hasta",{exact:true}).count(),1);
 assert.ok(matrices.some(x=>x.farmacias?.length===2));
 assert.equal(await page.getByRole("spinbutton",{name:"Pedir Crema de manos para el laboratorio"}).inputValue(),"8");
 for(const width of [1280,768,375]){
  await page.setViewportSize({width,height:812});
  const box=await page.locator(".fm-lab-order-scroll").evaluate(el=>({
   scrollWidth:el.scrollWidth,clientWidth:el.clientWidth,
   tableWidth:el.querySelector("table").getBoundingClientRect().width
  }));
  assert.ok(box.tableWidth>=box.clientWidth,"Tabla demasiado estrecha para "+width);
  if(width<800)assert.ok(box.scrollWidth>box.clientWidth,
   "En "+width+"px hay scroll horizontal dentro de la tabla");
 }
 await page.setViewportSize({width:1280,height:850});
 await page.getByLabel("Desde",{exact:true}).fill("2025-06-01");
 await page.getByLabel("Hasta",{exact:true}).fill("2025-08-31");
 await page.waitForTimeout(600);
 assert.ok(matrices.some(x=>x.desde==="2025-06-01"&&x.hasta==="2025-08-31"));
 const change=page.getByRole("spinbutton",{name:"Pedir Crema de manos para el laboratorio"});
 await change.fill("10");
 await page.getByRole("button",{name:"Guardar borrador"}).click();
 await page.getByText(/Borrador guardado/).waitFor();
 assert.equal(saved.at(-1).tipo,"parafarmacia");
 assert.equal(saved.at(-1).lineas[0].units,10);
 await page.goto(BASE+"/ajustes",{waitUntil:"domcontentloaded"});
 await page.getByRole("heading",{name:"Cobertura de stock global"}).waitFor({timeout:15000});
 await page.getByRole("spinbutton",{name:"Días de stock objetivo"}).fill("28");
 await page.getByRole("button",{name:"Guardar cobertura global"}).click();
 await page.getByText("Cobertura global actualizada para todas las farmacias.").waitFor();
 assert.deepEqual(stockWrites,[{days:28}]);
 assert.deepEqual(errors,[]);
 console.log("OK: preparador único, dos fechas, tabla móvil y ajustes stock");
}finally{await browser.close()}
