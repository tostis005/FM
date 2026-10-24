import {chromium} from "playwright";
import assert from "node:assert/strict";
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1240,height:850}});
const user={email:"source-ci@example.invalid",name:"Fuentes CI",role:"superadministrador"};
const context={user,client:{slug:"ampedia",name:"Ampedia",schema:"ampedia"},
 clients:[{slug:"ampedia",name:"Ampedia"}],role:"superadministrador",pharmacies:[],
 modules:{dashboard:true}};
let uploads=0;
const errors=[];
page.on("pageerror",e=>errors.push(e.message));
await page.route("**/api/**",async route=>{
 const req=route.request(),p=new URL(req.url());
 let body={};
 if(p.pathname==="/api/auth/me")body={user};
 else if(p.pathname==="/api/tenant/context")body=context;
 else if(p.pathname==="/api/admin/fuentes"){
  body={nomenclator:{version:"2026-10-23",total:33608,updatedAt:"2026-10-24T06:00:00Z"},
  vademecum:{version:uploads?"2026-10":"2026-09",total:uploads?2:100,
  updatedAt:"2026-10-24T06:00:00Z",sourceUrl:"https://example.com/catalogo"}};
 }else if(p.pathname==="/api/admin/fuentes/vademecum/cargar"){
  assert.equal(req.method(),"POST");
  assert.equal(p.searchParams.get("version"),"2026-10");
  assert.match(req.headers()["content-type"],/octet-stream/);
  uploads++;body={ok:true,total:2,version:"2026-10"};
 }
 await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});
});
try{
 await page.goto("http://127.0.0.1:4175/fuentes",{waitUntil:"domcontentloaded"});
 await page.getByRole("heading",{name:"Fuentes de datos"}).waitFor({timeout:15000});
 const source=page.locator(".fm-source-card").filter({has:page.getByRole("heading",{name:"Catálogo de artículos y laboratorios"})});
 await source.waitFor({timeout:15000});
 assert.equal(await source.count(),1);
 await source.getByRole("heading",{name:"Actualizar fichero"}).waitFor();
 await source.locator('input[type="file"]').setInputFiles({
  name:"referencias.csv",mimeType:"text/csv",
  buffer:Buffer.from("codigo_nacional;nombre;laboratorio\n000123;Crema;Zimfa\n")
 });
 await source.getByRole("button",{name:"Cargar nueva versión"}).click();
 try{await source.getByText(/Nueva fuente cargada:/).waitFor({timeout:9000})}
 catch(e){console.error("FUENTES DEBUG",JSON.stringify({uploads,errors,body:(await page.locator("body").innerText()).slice(-3500)}));throw e}
 assert.equal(uploads,1);
 assert.deepEqual(errors,[]);
 console.log("OK superadmin Fuentes: versión, fuente externa, upload CSV y actualización");
}finally{await browser.close()}
