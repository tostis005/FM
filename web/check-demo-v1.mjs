// Validación del recorrido comercial: menos navegación, trabajo real y avisos opt-in.
import {chromium} from "playwright";
import assert from "node:assert/strict";
const BASE=process.env.RESPONSIVE_BASE_URL||"http://127.0.0.1:4175";
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1300,height:800}});
const user={email:"demo@example.com",name:"Gestora demo",role:"superadministrador"};
const pharmacies=[{id:"1",name:"Farmacia Demo",sourceCode:"ABA",databaseCode:"ABA",active:true}];
const modules=Object.fromEntries(["dashboard","ventas","compras","stock","genericos","promociones","acciones","rentabilidad","reposicion"].map(x=>[x,true]));
const ctx={user,clients:[{slug:"demo",name:"Demo"}],client:{slug:"demo",name:"Demo",schema:"demo",analysisMonths:12},role:"superadministrador",pharmacies,modules};
const posted=[],errors=[];
page.on("pageerror",e=>errors.push(e.message));
await page.route("**/api/**",async route=>{
 const req=route.request(),u=new URL(req.url()),p=u.pathname;
 let payload={},status=200;
 if(p==="/api/auth/me")payload={user};
 else if(p==="/api/tenant/context")payload=ctx;
 else if(p==="/api/tenant/promociones")payload={promotions:[]};
 else if(p==="/api/tenant/farmacias")payload=pharmacies;
 else if(p==="/api/operativa/responsables")payload={items:[{email:user.email,role:"administrador"}]};
 else if(p==="/api/operativa/resumen-email"){
  if(req.method()==="PUT")posted.push(JSON.parse(req.postData()));
  payload={preference:req.method()==="PUT"?posted.at(-1):{frecuencia:"desactivado",dia_semana:1,hora:8},
   deliveryEnabled:false};
 }else if(p==="/api/operativa"){
  payload={items:[],scope:{canEdit:true,canApprove:true,cliente:"demo",farmacia:1}};
 }else if(p==="/api/analytics/dashboard/consolidados")payload={
  available:true,sales:{monthly:[],kpis:{ventas:2000,unidades:80}},purchases:{monthly:[],kpis:{compras:1000},
  available:true,hasAmounts:true,amountCoveragePct:100}};
 await route.fulfill({status,contentType:"application/json",body:JSON.stringify(payload)});
});
try{
 await page.goto(BASE+"/dashboard",{waitUntil:"domcontentloaded"});
 await page.getByRole("heading",{name:"Inicio",exact:true}).waitFor({timeout:15000});
 const sidebar=page.locator("#farmetrica-sidebar .side-nav");
 const top=await sidebar.locator(".side-nav-parent>.side-link").allTextContents();
 assert.deepEqual(top.map(x=>x.trim()),["Inicio","Ventas","Compras","Stock","Genéricos","Promociones","Trabajo y ahorro"]);
 assert.equal(await sidebar.getByRole("button",{name:"Proveedores",exact:true}).count(),0);
 assert.equal(await sidebar.getByRole("button",{name:"Alertas",exact:true}).count(),0);
 await sidebar.getByRole("button",{name:"Trabajo y ahorro"}).click();
 await page.getByRole("heading",{name:"Trabajo y ahorro"}).waitFor({timeout:15000});
 const tabs=page.getByRole("tablist",{name:"Trabajo y ahorro"});
 for(const label of ["Oportunidades","Mis tareas","Alertas","Ahorro verificado","Correos"])
  assert.equal(await tabs.getByRole("tab",{name:label}).count(),1);
 await tabs.getByRole("tab",{name:"Correos"}).click();
 await page.getByRole("heading",{name:"Resumen de tareas por correo"}).waitFor({timeout:15000});
 await page.getByText("Envío todavía no activado en el servidor.",{exact:false}).waitFor();
 await page.getByLabel("Frecuencia").selectOption("semanal");
 await page.getByLabel("Día de envío").selectOption("5");
 await page.getByRole("button",{name:"Guardar preferencias"}).click();
 await page.getByText("Preferencias guardadas.",{exact:false}).waitFor();
 assert.equal(posted.length,1);
 assert.deepEqual(posted[0],{frecuencia:"semanal",dia_semana:5,hora:8});
 assert.deepEqual(errors,[]);
 console.log("OK demo v1: navegación compacta, centro de trabajo y correos desactivados por defecto");
}finally{await browser.close();}
