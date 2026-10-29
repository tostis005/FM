// Regression de diseño y comportamiento del maestro segmentado y agenda.
import {chromium} from "playwright";
import assert from "node:assert/strict";
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1240,height:860}});
const user={email:"views-qa@example.invalid",role:"superadministrador",name:"QA"};
const pharmacies=[
 {id:"1",name:"Centro",sourceCode:"ABA",databaseCode:"ABA",active:true},
 {id:"2",name:"Norte",sourceCode:"NOR",databaseCode:"NOR",active:true}
];
const context={user,clients:[{slug:"ampedia",name:"Ampedia"}],
 client:{slug:"ampedia",name:"Ampedia",schema:"ampedia"},role:"superadministrador",
 pharmacies,modules:{proveedores:true,compras:true,dashboard:true}};
let suppliers=[
 {id:"1",key:"P:1",name:"Laboratorios Alfa SA",class:"DIRECTO",
  origins:[{pharmacyCode:"ABA",sourceCode:"0025",sourceName:"Laboratorios Alfa"}]},
 {id:"2",key:"P:2",name:"Alfa SA",class:"DIRECTO",
  origins:[{pharmacyCode:"NOR",sourceCode:"25",sourceName:"Alfa"}]},
 {id:"3",key:"P:3",name:"Cooperativa Central",class:"MAYORISTA",
  origins:[{pharmacyCode:"ABA",sourceCode:"100",sourceName:"Cooperativa Central"}]},
 {id:"4",key:"P:4",name:"Movimiento interno",class:"INTERNO",
  origins:[{pharmacyCode:"ABA",sourceCode:"105",sourceName:"Movimiento interno"}]}
];
const origins=[
 {sourceCode:"0025",name:"Laboratorios Alfa",origins:[{pharmacyId:"1",name:"Laboratorios Alfa",source:"farmatic"}]},
 {sourceCode:"25",name:"Alfa",origins:[{pharmacyId:"2",name:"Alfa",source:"farmatic"}]},
 {sourceCode:"100",name:"Cooperativa Central",origins:[{pharmacyId:"1",name:"Cooperativa Central",source:"farmatic"}]},
 {sourceCode:"105",name:"Movimiento interno",origins:[{pharmacyId:"1",name:"Movimiento interno",source:"farmatic"}]},
 {sourceCode:"200",name:"Sin clasificar B",origins:[{pharmacyId:"2",name:"Sin clasificar B",source:"farmatic"}]}
];
let frequency=[],writes=[],errors=[],catalogRequests=0;
page.on("pageerror",e=>errors.push(e.message));
await page.route("**/api/**",async route=>{
 const req=route.request(),u=new URL(req.url()),path=u.pathname;
 let body=[];
 if(path==="/api/auth/me")body={user};
 else if(path==="/api/tenant/context")body=context;
 else if(path==="/api/tenant/farmacias")body=pharmacies;
 else if(path==="/api/tenant/proveedores")body=origins;
 else if(path==="/api/tenant/proveedores-unificados")body=suppliers;
 else if(path==="/api/tenant/pedidos/frecuencias"){
  if(req.method()==="PUT"){
   const data=req.postDataJSON();writes.push(data);
   frequency=frequency.filter(p=>p.key!==data.key);
   if(data.days!==null)frequency.push(data);
   body=data;
  }else body={items:frequency};
 }
 else if(path==="/api/tenant/proveedores-unificados/clasificar-origen"){
  const data=req.postDataJSON();writes.push(data);
  suppliers=[...suppliers,{id:"5",key:"P:5",name:data.name,class:data.class,
   origins:[{pharmacyCode:data.pharmacyCode,sourceCode:data.sourceCode,sourceName:data.sourceName}]}];
  body={saved:true,id:"5"};
 }
 else if(path==="/api/analytics/pedidos/proveedores-unificados")
  body={laboratories:suppliers.filter(p=>p.class==="DIRECTO").map(p=>({key:p.key,name:p.name}))};
 else if(path==="/api/analytics/pedidos/agenda")
  body={today:"2026-10-29",items:[{
   key:"P:1",name:"Laboratorios Alfa SA",days:4,cn:240,overdue:0,today:1,tomorrow:0,withoutDate:1,
   nextDue:"2026-10-29",lastOrder:null,daysUntil:0,status:"hoy",provisional:true},{
   key:"P:2",name:"Alfa SA",days:7,cn:140,overdue:0,today:0,tomorrow:1,withoutDate:1,
   nextDue:"2026-10-30",lastOrder:null,daysUntil:1,status:"manana",provisional:true}]};
 else if(path==="/api/analytics/pedidos/catalogo-unificado"){
  catalogRequests++;body={rows:[],total:0,from:"2026-10-01",to:"2026-10-29"};
 }
 await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});
});
try{
 await page.goto("http://127.0.0.1:4175/proveedores-maestro",{waitUntil:"domcontentloaded"});
 await page.getByRole("heading",{name:"Maestro de proveedores"}).waitFor({timeout:15000});
 await page.getByRole("tab",{name:/Laboratorios/}).click();
 assert.equal(await page.getByRole("button",{name:/Unificación de laboratorios/}).count(),0);
 await page.getByText("Laboratorios Alfa SA").first().waitFor();
 assert.equal(await page.getByRole("combobox",{name:/Frecuencia de Laboratorios Alfa SA/}).count(),1);
 await page.getByRole("combobox",{name:/Frecuencia de Laboratorios Alfa SA/}).selectOption("3");
 await page.getByText("Frecuencia actualizada").waitFor();
 assert.equal(writes[0].days,3);
 assert.equal(writes[0].key,"P:1");
 await page.getByRole("tab",{name:/Mayoristas/}).click();
 assert.equal(await page.getByRole("combobox",{name:/Frecuencia de/}).count(),0);
 assert.equal(await page.locator(".fm-master-lab-tools").count(),0);
 await page.getByText("Cooperativa Central").first().waitFor();
 await page.getByRole("tab",{name:/Internos/}).click();
 assert.equal(await page.locator(".fm-master-lab-tools").count(),0);
 await page.getByRole("tab",{name:/Todos/}).click();
 await page.getByText("Sin clasificar B").first().waitFor();
 await page.getByRole("tab",{name:/Sin vincular/}).click();
 await page.getByRole("button",{name:/Clasificar \/ vincular/}).first().click();
 const dialog=page.getByRole("dialog",{name:"Relacionar código de Farmatic"});
 await dialog.getByLabel("Tipo del nuevo proveedor").selectOption("INTERNO");
 await dialog.getByRole("button",{name:/Crear proveedor interno independiente/}).click();
 await page.getByText("Origen clasificado").waitFor();
 assert.equal(writes.at(-1).class,"INTERNO");
 for(const width of [1240,768,375]){
  await page.setViewportSize({width,height:830});
  const sizes=await page.evaluate(()=>({
   window:document.documentElement.clientWidth,
   scroll:document.documentElement.scrollWidth,
   table:document.querySelector(".fm-master-table-scroll")
  }));
  assert.ok(sizes.scroll<=sizes.window+5,"Desbordamiento horizontal del maestro en "+width+"px: "+JSON.stringify(sizes));
 }
 await page.goto("http://127.0.0.1:4175/compras-preparador",{waitUntil:"domcontentloaded"});
 await page.getByRole("heading",{name:/Planificación de pedidos/}).waitFor({timeout:15000});
 await page.getByText("Laboratorios Alfa SA").first().waitFor();
 await page.getByText("240 códigos nacionales únicos").waitFor();
 const agenda=page.locator(".fm-order-agenda");
 assert.equal(await agenda.locator("select,input[type=search]").count(),0);
 assert.equal(await agenda.getByRole("button",{name:/Hoy\s*1|1\s*Hoy/}).count(),1);
 assert.equal(await agenda.getByText(/Previsión de demostración/).count(),1);
 const requestCatalog=page.waitForResponse(r=>r.url().includes("/api/analytics/pedidos/catalogo-unificado"));
 await agenda.getByRole("button",{name:/Laboratorios Alfa SA/}).click();
 await requestCatalog;
 assert.ok(catalogRequests>=1,"Pulsar laboratorio debe consultar automáticamente CN");
 await agenda.getByRole("button",{name:/Mañana/}).click();
 await agenda.getByText("Alfa SA",{exact:true}).first().waitFor();

 assert.equal(await page.getByText("Farmacias pendientes:").count(),0);
 for(const width of [1240,768,375]){
  await page.setViewportSize({width,height:830});
  const sizes=await page.evaluate(()=>({
   window:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth
  }));
  assert.ok(sizes.scroll<=sizes.window+5,"Desbordamiento horizontal de agenda en "+width+"px: "+JSON.stringify(sizes));
 }
 assert.deepEqual(errors,[]);
 console.log("OK maestro por categorías, clasificación independiente, frecuencia y agenda responsive");
}finally{await browser.close()}
