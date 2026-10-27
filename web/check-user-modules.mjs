import {chromium} from "playwright";
import assert from "node:assert/strict";
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1280,height:850}});
const user={email:"user-modules-ci@example.invalid",name:"Administración CI",role:"superadministrador"};
const pharmacies=[{id:"1",name:"Abadía",sourceCode:"ABA"},
 {id:"2",name:"Europa",sourceCode:"EUR"}];
const context={user,client:{slug:"ampedia",name:"Ampedia",schema:"ampedia"},
 clients:[{slug:"ampedia",name:"Ampedia"}],role:"superadministrador",pharmacies,
 modules:{dashboard:true,ventas:true,compras:true,proveedores:true,promociones:false}};
let stored=[
 {email:"empleado@example.invalid",name:"Empleado",role:"farmacia",
  pharmacies:["1"],active:true,authType:"google",modules:["ventas"]},
 {email:"plantilla@example.invalid",name:"Plantilla",role:"colaborador",
  pharmacies:["2"],active:true,authType:"google",modules:["compras"],sections:["compras-preparador"]}
];
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
   grantable:["ventas","compras"],
   sections:[
    {id:"ventas",module:"ventas",name:"Ventas (resumen)",demo:true},
    {id:"ventas-tickets",module:"ventas",name:"Tickets",demo:false},
    {id:"compras",module:"compras",name:"Compras (resumen)",demo:true},
    {id:"compras-preparador",module:"compras",name:"Preparador de pedidos",demo:false}
   ],grantableSections:["ventas","ventas-tickets","compras","compras-preparador"]};
 else if(path==="/api/tenant/usuarios"){
  if(req.method()==="PUT"){
   const next=req.postDataJSON();writes.push(next);
   stored=[...stored.filter(item=>item.email!==next.email),next];
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
 await page.getByText("Secciones y subsecciones autorizadas").waitFor();
 const area=page.locator(".fm-user-module-section");
 assert.equal(await area.locator("input[type=checkbox]").count(),6);
 assert.equal(await area.getByText("Promociones").count(),0);
 assert.equal(await area.getByText("Demo",{exact:true}).count(),2);
 const sales=area.locator(".fm-user-module-parent input[type=checkbox]").nth(0);
 const purchases=area.locator(".fm-user-module-parent input[type=checkbox]").nth(1);
 assert.equal(await sales.isChecked(),true);
 assert.equal(await purchases.isChecked(),false);
 await area.getByRole("button",{name:"Solo pantallas operativas"}).click();
 assert.equal(await sales.isChecked(),true);
 assert.equal(await purchases.isChecked(),true);
 assert.equal(await area.getByRole("checkbox",{name:/Ventas \(resumen\)/}).isChecked(),false);
 assert.equal(await area.getByRole("checkbox",{name:/Compras \(resumen\)/}).isChecked(),false);
 assert.equal(await area.getByRole("checkbox",{name:"Tickets"}).isChecked(),true);
 assert.equal(await area.getByRole("checkbox",{name:"Preparador de pedidos"}).isChecked(),true);
 await page.getByRole("button",{name:"Guardar cambios"}).click();
 await page.getByText("Usuario y permisos guardados correctamente.").waitFor();
 assert.deepEqual(writes.at(-1).modules.sort(),["compras","ventas"]);
 assert.deepEqual(writes.at(-1).sections.sort(),["compras-preparador","ventas-tickets"]);
 // Acción de la tabla: editar destino y elegir otro usuario como plantilla.
 await page.getByRole("button",{name:"Copiar permisos a Empleado"}).click();
 const sourcePicker=page.locator("#fm-copy-permissions-source");
 assert.equal(await sourcePicker.locator('option[value="empleado@example.invalid"]').count(),0);
 const previousWrites=writes.length;
 await sourcePicker.selectOption("plantilla@example.invalid");
 assert.equal(writes.length,previousWrites,"La copia no guarda sin confirmación explícita");
 assert.equal(await page.locator('.fm-manage-form select').filter({has:page.locator('option[value="colaborador"]')}).first().inputValue(),"colaborador");
 assert.equal(await area.getByRole("checkbox",{name:"Preparador de pedidos"}).isChecked(),true);
 assert.equal(await area.getByRole("checkbox",{name:"Tickets"}).isChecked(),false);
 assert.equal(await page.getByRole("checkbox",{name:"Europa"}).isChecked(),true);
 assert.equal(await page.getByRole("checkbox",{name:"Abadía"}).isChecked(),false);
 assert.equal(await page.locator('input[type=email]').inputValue(),"empleado@example.invalid");
 await page.getByRole("button",{name:"Guardar cambios"}).click();
 const copied=writes.at(-1);
 assert.equal(copied.email,"empleado@example.invalid");
 assert.equal(copied.name,"Empleado");
 assert.equal(copied.authType,"google");
 assert.equal(copied.role,"colaborador");
 assert.deepEqual(copied.pharmacies,["2"]);
 assert.deepEqual(copied.modules,["compras"]);
 assert.deepEqual(copied.sections,["compras-preparador"]);
 // Alta nueva: la misma plantilla no debe copiar identidad ni método de acceso.
 await page.locator('input[type=email]').fill("nuevo@example.invalid");
 await page.locator('input[placeholder="Nombre y apellidos"]').fill("Usuario nuevo");
 await sourcePicker.selectOption("plantilla@example.invalid");
 assert.equal(await page.locator('input[type=email]').inputValue(),"nuevo@example.invalid");
 await page.getByRole("button",{name:"Crear usuario"}).click();
 const created=writes.at(-1);
 assert.equal(created.email,"nuevo@example.invalid");
 assert.equal(created.name,"Usuario nuevo");
 assert.equal(created.authType,"google");
 assert.equal(created.role,"colaborador");
 assert.deepEqual(created.pharmacies,["2"]);
 assert.deepEqual(created.modules,["compras"]);
 assert.deepEqual(created.sections,["compras-preparador"]);
 assert.equal(errors.length,0,errors.join("\n"));
 console.log("OK permisos de usuario: edición, copia entre usuarios y alta con plantilla");
}finally{await browser.close()}
