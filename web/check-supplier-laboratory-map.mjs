import {chromium} from "playwright";
import assert from "node:assert/strict";

const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1280,height:820}});
const user={email:"supplier-ci@example.invalid",name:"Administrador CI",role:"superadministrador"};
const pharmacies=[{id:"1",name:"Abadía",sourceCode:"ABA"}];
const context={user,client:{slug:"ampedia",name:"Ampedia",schema:"ampedia"},
 clients:[{slug:"ampedia",name:"Ampedia"}],role:"superadministrador",
 pharmacies,modules:{dashboard:true,compras:true,proveedores:true}};
let suppliers=[
 {id:null,sourceCode:"PR1",name:"Proveedor Farmatic",type:"sin_clasificar",
  cooperative:false,ignoreReports:false,laboratoryKey:null},
 {id:"9",sourceCode:"COOP",name:"Cooperativa CI",type:"cooperativa",
  cooperative:true,ignoreReports:false,laboratoryKey:null},
 {id:null,sourceCode:"ZI1",name:"Zimfa",type:"sin_clasificar",cooperative:false,ignoreReports:false,laboratoryKey:null}
];
let saved=null;const errors=[];
page.on("pageerror",e=>errors.push(e.message));
await page.route("**/api/**",async route=>{
 const req=route.request(),url=new URL(req.url()),path=url.pathname;
 let body={};
 if(path==="/api/auth/me")body={user};
 else if(path==="/api/tenant/context")body=context;
 else if(path==="/api/tenant/farmacias")body=pharmacies;
 else if(path==="/api/tenant/proveedores")body=suppliers;
 else if(path==="/api/analytics/pedidos/catalogo-laboratorios")
  body={laboratories:[{key:"N:CINFA",name:"Laboratorios Cinfa"},{key:"N:ZIMFA",name:"Zimfa"}]};
 else if(path==="/api/tenant/proveedores/correspondencias")body=[];
 else if(path==="/api/tenant/proveedores/autovincular"&&req.method()==="POST"){
  const args=req.postDataJSON();
  const suggestion={sourceCode:"ZI1",name:"Zimfa",laboratoryKey:"N:ZIMFA"};
  if(args.apply){
   suppliers=suppliers.map(x=>x.sourceCode==="ZI1"?{...x,laboratoryKey:"N:ZIMFA"}:x);
   body={suggestions:[suggestion],count:1,applied:1,
    updated:[{sourceCode:"ZI1",laboratoryKey:"N:ZIMFA"}]};
  }else body={suggestions:[suggestion],count:1,applied:0};
 }
 else if(path==="/api/tenant/proveedores/laboratorio"&&req.method()==="PUT"){
  saved=req.postDataJSON();assert.equal(saved.sourceCode,"PR1");
  assert.equal(saved.laboratoryKey,"N:CINFA");
  suppliers=suppliers.map(x=>x.sourceCode===saved.sourceCode?
   {...x,laboratoryKey:saved.laboratoryKey}:x);
  body=suppliers[0];
 }
 else if(req.method()==="GET")body=[];
 await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});
});
try{
 await page.goto("http://127.0.0.1:4175/proveedores-maestro",{waitUntil:"domcontentloaded"});
 await page.getByRole("heading",{name:"Maestro de proveedores"}).waitFor({timeout:15000});
 await page.getByRole("button",{name:"Asignar laboratorio"}).first().click();
 await page.getByRole("dialog",{name:"Asignar laboratorio a proveedor"}).waitFor();
 const dlg=page.getByRole("dialog",{name:"Asignar laboratorio a proveedor"});
 const picker=dlg.getByRole("combobox",{name:"Seleccionar laboratorio asociado"});
 assert.equal(await picker.count(),1,"Buscador y selector unificados en un único campo");
 assert.equal(await dlg.locator("select").count(),0,"Sin segundo desplegable nativo");
 await picker.fill("Cinfa");
 assert.equal(await dlg.getByRole("option",{name:"Laboratorios Cinfa"}).count(),1);
 await dlg.getByRole("option",{name:"Laboratorios Cinfa"}).click();
 await dlg.getByRole("button",{name:"Guardar asignación"}).click();
 await page.getByRole("button",{name:"Laboratorios Cinfa"}).waitFor({timeout:9000});
 assert.equal(saved.laboratoryKey,"N:CINFA");
 await page.getByRole("button",{name:/Vincular laboratorios automáticamente/}).click();
 await page.getByRole("button",{name:/Aplicar 1 vinculaciones seguras/}).click();
 await page.getByRole("button",{name:"Zimfa"}).waitFor({timeout:9000});
 assert.equal(errors.length,0,errors.join("\n"));
 console.log("OK maestro proveedores: asignación de laboratorio importado al proveedor ERP");
}finally{await browser.close()}
