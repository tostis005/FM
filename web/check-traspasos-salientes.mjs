// Regresión del maestro actual: la clasificación INTERNO/MAYORISTA limita el
// selector del preparador, NO borra compras/ventas del dashboard.
// El antiguo panel de "Ignorar en informes" no debe reaparecer al cambiarlo.
import assert from "node:assert/strict";
import {chromium} from "playwright";
const BASE=process.env.RESPONSIVE_BASE_URL||"http://127.0.0.1:4175";
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1100,height:820}});
const user={email:"qa.traspasos@example.invalid",name:"QA",role:"superadministrador"};
const pharmacies=[{id:"1",name:"Farmacia origen",sourceCode:"ABA",databaseCode:"ABA",active:true}];
const sources=[{id:91,sourceCode:"INT1",name:"Farmacia receptora",
 type:"otros",active:true,cooperative:false,ignoreReports:true,
 origins:[{pharmacyId:"1",name:"Farmacia receptora",source:"farmatic"}]}];
let unified=[{id:91,key:"INT1",name:"Farmacia receptora",class:"INTERNO",origins:[
 {pharmacyCode:"ABA",sourceCode:"INT1",sourceName:"Farmacia receptora"}]}];
let saved=[],errors=[];
page.on("pageerror",e=>errors.push(e.message));
await page.route("**/api/**",async route=>{
 const req=route.request(),url=new URL(req.url()),p=url.pathname;
 let status=200,body={};
 if(p==="/api/auth/me")body={user};
 else if(p==="/api/tenant/context")body={user,role:"superadministrador",
  client:{slug:"ampedia",name:"Ampedia",schema:"ampedia"},
  modules:{proveedores:true},pharmacies,
  clients:[{slug:"ampedia",name:"Ampedia"}],allowedPharmacyIds:[1]};
 else if(p==="/api/tenant/farmacias")body=pharmacies;
 else if(p==="/api/tenant/proveedores")body=sources;
 else if(p==="/api/tenant/proveedores-unificados"){
  if(req.method()==="POST"){
   const data=req.postDataJSON();
   saved.push(data);
   body={ok:true};
  }else body=unified;
 }
 else if(p==="/api/tenant/proveedores-unificados/91"&&req.method()==="PUT"){
  const data=req.postDataJSON();
  assert.equal(data.name,"Farmacia receptora");
  assert.equal(data.class,"MAYORISTA");
  saved.push(data);
  unified=unified.map(x=>({...x,class:data.class}));
  body=unified[0];
 }
 await route.fulfill({status,contentType:"application/json",body:JSON.stringify(body)});
});
try{
 await page.goto(BASE+"/proveedores-maestro",{waitUntil:"domcontentloaded"});
 await page.getByRole("heading",{name:"Maestro único de proveedores"}).waitFor({timeout:15000});
 await page.getByRole("table").first().getByText("Farmacia receptora",{exact:true}).waitFor();
 assert.equal(await page.getByText("INTERNO",{exact:true}).count(),1);
 assert.equal(await page.getByRole("heading",{name:"Traspasos salientes entre farmacias"}).count(),0,
  "No reintroducir la interfaz de exclusión histórica obsoleta");
 await page.getByRole("button",{name:"Editar"}).first().click();
 const dialog=page.getByRole("dialog",{name:"Editar proveedor"});
 await dialog.getByRole("combobox",{name:"Clasificación"}).selectOption("MAYORISTA");
 await dialog.getByText(/Los movimientos históricos siguen contando en los totales/).waitFor();
 await dialog.getByRole("button",{name:"Guardar"}).click();
 await page.getByText("MAYORISTA",{exact:true}).first().waitFor();
 assert.equal(saved.length,1);
 assert.deepEqual(errors,[]);
 console.log("OK: maestro unificado; internos y mayoristas solo afectan al preparador, no a totales");
}finally{await browser.close();}
