import {chromium} from "playwright";
import assert from "node:assert/strict";

const BASE=process.env.RESPONSIVE_BASE_URL||"http://127.0.0.1:4175";
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1270,height:820}});
const user={email:"qa@example.com",name:"QA",role:"superadministrador"};
const pharmacy={id:"1",name:"Abadía",sourceCode:"ABA",databaseCode:"ABA",active:true};
let role="superadministrador",deleted=false,deleteRequests=0;
const promo={id:"XABC1234",name:"Oferta con objetivos",subtitle:"Laboratorio",
 status:"Activa",cns:["123456"],targets:{"1":10},start:"2026-10-01",
 end:"2026-10-31",sales:{},type:"tres_por_dos"};
const archived={...promo,id:"XDEF2345",name:"Campaña archivada",
 status:"Finalizada",start:"2026-09-01",end:"2026-09-30"};
const errors=[];
page.on("pageerror",err=>errors.push(err.message));
await page.route("**/api/**",async route=>{
 const url=new URL(route.request().url()),path=url.pathname,method=route.request().method();
 let body={};
 if(path==="/api/auth/me")body={user:{...user,role}};
 else if(path==="/api/tenant/context")body={
  user:{...user,role},client:{slug:"ampedia",name:"Ampedia",schema:"ampedia"},
  clients:[{slug:"ampedia",name:"Ampedia"}],role,
  modules:{promociones:true,dashboard:true},pharmacies:[pharmacy],allowedPharmacyIds:[1]
 };
 else if(path==="/api/tenant/farmacias")body=[pharmacy];
 else if(path==="/api/tenant/promociones")body={
  promotions:deleted?[archived]:[promo,archived],
  deletedIds:deleted?[promo.id]:[]
 };
 else if(path==="/api/tenant/promociones/"+promo.id&&method==="DELETE"){
  deleteRequests++;deleted=true;body={id:promo.id,deleted:true};
 }else if(path==="/api/tenant/promociones")body={promotions:[promo,archived]};
 else if(path==="/api/ventas/seguimiento")body={sales:{}};
 await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});
});
try{
 await page.goto(BASE+"/promociones",{waitUntil:"domcontentloaded"});
 const del=page.getByRole("button",{name:"Eliminar Oferta con objetivos"});
 await del.waitFor({state:"visible",timeout:14000});
 await page.getByText("Archivada",{exact:true}).first().waitFor();
 // Cancelar no envía una operación destructiva.
 page.once("dialog",dialog=>dialog.dismiss());
 await del.click();
 assert.equal(deleteRequests,0);
 assert.equal(await del.count(),1);
 // Confirmación y borrado persistido en servidor.
 page.once("dialog",dialog=>{
  assert.match(dialog.message(),/Oferta con objetivos/);
  assert.match(dialog.message(),/No se puede deshacer/);
  return dialog.accept();
 });
 await del.click();
 await page.waitForFunction(()=>document.body.textContent.includes("Promoción eliminada"),null,{timeout:9000});
 assert.equal(deleteRequests,1);
 assert.equal(await del.count(),0);
 // Al recargar no reaparece ni la copia anterior.
 await page.reload({waitUntil:"domcontentloaded"});
 await page.getByRole("heading",{name:"Promociones",exact:true}).waitFor();
 await page.getByText("Campaña archivada").first().waitFor();
 assert.equal(await page.getByRole("button",{name:"Eliminar Oferta con objetivos"}).count(),0);
 assert.deepEqual(errors,[]);
 console.log("OK: eliminar promociones cancela o confirma, persiste y no reaparece");
}finally{await browser.close();}
