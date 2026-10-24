import {chromium} from "playwright";
import assert from "node:assert/strict";
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1280,height:850}});
const user={email:"user-modules-ci@example.invalid",name:"Administración CI",role:"superadministrador"};
const pharmacies=[{id:"1",name:"Abadía",sourceCode:"ABA"}];
const context={user,client:{slug:"ampedia",name:"Ampedia",schema:"ampedia"},
 clients:[{slug:"ampedia",name:"Ampedia"}],role:"superadministrador",pharmacies,
 modules:{dashboard:true,ventas:true,compras:true,proveedores:true,promociones:false}};
let stored=[{email:"empleado@example.invalid",name:"Empleado",role:"farmacia",
 pharmacies:["1"],active:true,authType:"google",modules:["ventas"]}];
const writes=[],errors=[];
page.on("pageerror",e=>errors.push(e.message));
await page.route("**/api/**",async route=>{
 const req=route.request(),url=new URL(req.url()),path=url.pathname;
 let body={};
 if(path==="/api/auth/me")body={user};
 else if(path==="/api/tenant/context")body=context;
 else if(path==="/api/tenant/farmacias")body=pharmacies;
 else if(path==="/api/tenant/usuarios/modulos")
  body={modules:[{id:"ventas",name:"Ventas"},{id:"compras",name:"Compras"}],
   grantable:["ventas","compras"]};
 else if(path==="/api/tenant/usuarios"){
  if(req.method()==="PUT"){
   const next=req.postDataJSON();writes.push(next);
   stored=[{...stored[0],...next}];
   body=next;
  }else body=stored;
 }
 await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});
});
try{
 await page.goto("http://127.0.0.1:4175/usuarios",{waitUntil:"domcontentloaded"});
 await page.getByText("Usuarios y permisos del cliente").first().waitFor({timeout:15000});
 await page.getByText("Empleado").first().waitFor({timeout:15000});
 await page.getByRole("button",{name:"Editar"}).first().click();
 await page.getByText("Funcionalidades autorizadas").waitFor();
 const area=page.locator(".fm-user-module-section");
 assert.equal(await area.locator("input[type=checkbox]").count(),2);
 assert.equal(await area.getByText("Promociones").count(),0);
 const sales=area.getByRole("checkbox",{name:"Ventas"});
 const purchases=area.getByRole("checkbox",{name:"Compras"});
 assert.equal(await sales.isChecked(),true);
 assert.equal(await purchases.isChecked(),false);
 await purchases.check();
 await page.getByRole("button",{name:"Guardar cambios"}).click();
 await page.getByText("Usuario y permisos guardados correctamente.").waitFor();
 assert.deepEqual(writes.at(-1).modules.sort(),["compras","ventas"]);
 assert.equal(errors.length,0,errors.join("\n"));
 console.log("OK módulos por usuario: catálogo del cliente, edición y guardado de la selección");
}finally{await browser.close()}
