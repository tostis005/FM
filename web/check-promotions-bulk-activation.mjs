// Reproducción móvil: seleccionar «prueba» y «prueba 2», explicar exactamente
// la validación fallida sin activar ninguna, y confirmar reintento correcto.
import {chromium} from "playwright";
import assert from "node:assert/strict";

const BASE=process.env.RESPONSIVE_BASE_URL||"http://127.0.0.1:4175";
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
const user={email:"qa@example.invalid",name:"QA",role:"superadministrador"};
const pharmacies=[{id:"1",name:"Abadía",active:true,sourceCode:"ABA"}];
const month=new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Madrid",year:"numeric",month:"2-digit"}).format(new Date());
const periodStart=month+"-01",periodEnd=month+"-28";
const promos=[
 {id:"TEST-1",name:"prueba",status:"Borrador",start:periodStart,end:periodEnd,
  durationMode:"dates",type:"dos_por_uno",cns:["123456"],targets:{"1":0},
  monthlyObjectives:{[month]:{targets:{"1":30}}}},
 {id:"TEST-2",name:"prueba 2",status:"Borrador",start:periodStart,end:periodEnd,
  durationMode:"dates",type:"descuento_porcentaje",discountPercent:"",
  cns:["123456"],targets:{"1":""},monthlyObjectives:{[month]:{targets:{"1":20}}}}
];
const attempts=[],errors=[];
let shouldReject=true;
page.on("pageerror",e=>errors.push(e.message));
await page.route("**/api/**",async route=>{
 const path=new URL(route.request().url()).pathname,method=route.request().method();
 let status=200,body={};
 if(path==="/api/auth/me")body={user};
 else if(path==="/api/tenant/context")body={
  user,role:"superadministrador",client:{slug:"ampedia",name:"Ampedia",schema:"ampedia"},
  clients:[{slug:"ampedia",name:"Ampedia"}],modules:{promociones:true},
  pharmacies,allowedPharmacyIds:[1]
 };
 else if(path==="/api/tenant/farmacias")body=pharmacies;
 else if(path==="/api/tenant/promociones")body={promotions:promos,deletedIds:[]};
 else if(path==="/api/ventas/seguimiento")body={sales:{},totalSales:{}};
 else if(path==="/api/tenant/promociones/activar-lote"&&method==="POST"){
  const ids=route.request().postDataJSON().ids;
  attempts.push(ids);
  if(shouldReject){
   status=400;
   body={error:"No se activó ninguna promoción. «prueba 2»: falta un porcentaje de descuento válido (1–100 %)",
    invalidPromotions:[{id:"TEST-2",name:"prueba 2",
     reasons:["falta un porcentaje de descuento válido (1–100 %)"]}]};
  }else{
   for(const promo of promos){promo.status="Activa";promo.statusSource="manual";}
   body={activatedIds:ids};
  }
 }
 await route.fulfill({status,contentType:"application/json",body:JSON.stringify(body)});
});
try{
 await page.goto(BASE+"/promociones",{waitUntil:"domcontentloaded"});
 await page.getByRole("combobox",{name:"Estado"}).selectOption("Todos");
 await page.getByRole("checkbox",{name:"Seleccionar prueba",exact:true}).check();
 await page.getByRole("checkbox",{name:"Seleccionar prueba 2",exact:true}).check();
 page.once("dialog",dialog=>dialog.accept());
 await page.getByRole("button",{name:"Activar seleccionadas"}).click();
 const explanation=page.locator(".fm-promotion-activation-error");
 await explanation.waitFor({timeout:15000});
 assert.match(await explanation.innerText(),/prueba 2/);
 assert.match(await explanation.innerText(),/porcentaje de descuento válido/);
 assert.match(await explanation.innerText(),/No se activó ninguna promoción/);
 assert.equal(attempts.length,1);
 assert.deepEqual([...attempts[0]].sort(),["TEST-1","TEST-2"]);
 assert.equal(promos.every(p=>p.status==="Borrador"),true,"El lote fallido no publica parcialmente");
 assert.equal(await page.getByRole("checkbox",{name:"Seleccionar prueba 2"}).isChecked(),true);
 assert.equal(await page.getByRole("checkbox",{name:"Seleccionar prueba",exact:true}).isChecked(),true);
 shouldReject=false;
 page.once("dialog",dialog=>dialog.accept());
 await page.getByRole("button",{name:"Activar seleccionadas"}).click();
 await explanation.waitFor({state:"hidden",timeout:15000});
 await page.waitForFunction(()=>[...document.querySelectorAll(".campaign-table tbody tr")]
  .filter(row=>/prueba/.test(row.textContent||"")).every(row=>
   row.textContent.includes("Activa")),{timeout:15000});
 assert.equal(attempts.length,2);
 assert.equal(promos.every(p=>p.status==="Activa"),true);
 assert.deepEqual(errors,[]);
 console.log("PROMOCIONES_ACTIVACION_LOTE_OK: problema de prueba 2 explícito, lote atómico, segundo intento correcto");
}finally{await browser.close()}
