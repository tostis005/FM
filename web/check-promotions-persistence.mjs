// Auditoría de consistencia: las promociones solo existen cuando PostgreSQL confirma.
import {chromium} from "playwright";
import assert from "node:assert/strict";

const BASE=process.env.RESPONSIVE_BASE_URL||"http://127.0.0.1:4175";
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1200,height:850}});
const user={email:"qa.promo@example.invalid",name:"QA",role:"superadministrador"};
const pharmacy={id:"1",name:"Farmacia Centro",sourceCode:"ABA",active:true};
const cached={id:"PCACHE",name:"CAMPAÑA ANTIGUA EN CACHÉ",status:"Activa",
 cns:["123456"],targets:{"1":3},start:"2026-10-01",end:"2026-10-31",type:"tres_por_dos"};
let offline=true,firstSaveFails=true,role="superadministrador",saved=[],saveCalls=0;
const pageErrors=[];
page.on("pageerror",e=>pageErrors.push(e.message));
await page.addInitScript(({user,cached,pharmacy})=>{
 localStorage.setItem("farmetrica-prototype-v1:ampedia:"+user.email,
  JSON.stringify({promos:[cached],pharmacies:[pharmacy],users:[],objectiveSeedVersion:"2026-10"}));
},{user,cached,pharmacy});
await page.route("**/api/**",async route=>{
 const url=new URL(route.request().url()),path=url.pathname,method=route.request().method();
 const userForRole={...user,role};
 let body={},status=200;
 if(path==="/api/auth/me")body={user:userForRole};
 else if(path==="/api/tenant/context")body={
  user:userForRole,role,client:{slug:"ampedia",name:"Ampedia",schema:"ampedia"},
  clients:[{slug:"ampedia",name:"Ampedia"}],modules:{promociones:true,dashboard:true},
   sections:{promociones:true,"seguimiento-global":true},
  pharmacies:[pharmacy],allowedPharmacyIds:[1]
 };
 else if(path==="/api/tenant/farmacias")body=[pharmacy];
 else if(path==="/api/tenant/promociones"&&method==="GET"){
  if(offline){status=503;body={error:"Servicio de promociones sin conexión"}}
  else body={promotions:saved,deletedIds:[]};
 }
 else if(path.startsWith("/api/tenant/promociones/")&&method==="PUT"){
  saveCalls++;
  if(firstSaveFails){firstSaveFails=false;status=503;body={error:"PostgreSQL temporalmente no disponible"}}
  else{
   const promo=route.request().postDataJSON().promotion;
   saved=[promo,...saved.filter(p=>p.id!==promo.id)];
   body={ok:true,promotion:promo};
  }
 }
 else if(path==="/api/ventas/seguimiento")body={sales:{}};
 await route.fulfill({status,contentType:"application/json",body:JSON.stringify(body)});
});
try{
 await page.goto(BASE+"/promociones",{waitUntil:"domcontentloaded"});
 await page.getByRole("heading",{name:"No se pudieron consultar las promociones"}).waitFor({timeout:12000});
 assert.equal(await page.getByText(cached.name,{exact:true}).count(),0,
  "Un caché no puede hacerse pasar por catálogo vigente cuando el servidor falla");
 assert.equal(await page.getByRole("button",{name:"Nueva promoción"}).count(),0,
  "No permitir altas cuando el listado compartido es desconocido");
 offline=false;
 await page.getByRole("button",{name:"Reintentar"}).click();
 await page.getByRole("button",{name:"Nueva promoción"}).waitFor({timeout:10000});
 assert.equal(await page.getByText(cached.name,{exact:true}).count(),0,
  "Tras recuperar la conexión no deben revivir campañas antiguas del navegador");

 await page.getByRole("button",{name:"Nueva promoción"}).click();
 const modal=page.locator(".drawer").filter({hasText:"Nueva promoción"});
 await modal.getByLabel("Nombre de promoción").fill("Campaña de verificación");
 await modal.locator(".pharmacy-picker .pharmacy-choice").first().click();
 await modal.getByRole("spinbutton",{name:"Objetivo Farmacia Centro"}).fill("10");
 await modal.getByRole("button",{name:"Crear promoción"}).click();
 await modal.getByRole("alert").waitFor();
 assert.match(await modal.getByRole("alert").textContent(),
  /No se ha guardado la promoción: PostgreSQL temporalmente no disponible/);
 assert.equal(await modal.count(),1,"La promoción no confirmada permanece editable");
 assert.equal(await page.locator(".campaign-table").getByText("Campaña de verificación").count(),0,
  "No añadir una campaña sin confirmación del servidor");
 assert.equal(saved.length,0);

 await modal.getByRole("button",{name:"Crear promoción"}).click();
 await page.getByText("Promoción guardada correctamente").waitFor();
 await modal.waitFor({state:"detached"});
 assert.equal(saved.length,1);
 assert.equal(saveCalls,2);
 await page.reload({waitUntil:"domcontentloaded"});
 try{
  await page.locator(".campaign-table").getByText("Campaña de verificación").waitFor({timeout:12000});
 }catch(err){
  console.log("Auditoría tras recarga:",JSON.stringify({
   serverPromotions:saved.map(p=>({id:p.id,name:p.name,status:p.status,start:p.start,end:p.end})),
   visibleText:(await page.locator(".main-content").innerText()).slice(0,3000),
   url:page.url(),
   currentTenant:await page.evaluate(()=>localStorage.getItem("fm_active_tenant"))
  }));
  throw err;
 }
 assert.equal(await page.getByText(cached.name,{exact:true}).count(),0,
  "La lista tras recargar viene exclusivamente de la base de datos");

 role="farmacia";
 await page.reload({waitUntil:"domcontentloaded"});
 await page.locator(".campaign-table").getByText("Campaña de verificación").waitFor({timeout:15000});
 assert.equal(await page.getByRole("button",{name:"Nueva promoción"}).count(),0);
 assert.equal(await page.getByRole("button",{name:"Importar Excel"}).count(),0);
 assert.equal(await page.getByRole("button",{name:"Editar Campaña de verificación"}).count(),0);
 assert.ok(await page.getByRole("button",{name:"Seguimiento"}).count()>0);
 assert.deepEqual(pageErrors,[],"Sin excepciones del frontend");
 console.log("OK: sin falsas promociones locales; alta atómica; reintento; permisos de solo lectura");
}finally{await browser.close()}
