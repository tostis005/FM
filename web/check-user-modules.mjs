import {chromium} from "playwright";
import assert from "node:assert/strict";
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1280,height:850}});
const user={email:"user-modules-ci@example.invalid",name:"Administración CI",role:"superadministrador"};
const pharmacies=[{id:"1",name:"Abadía",sourceCode:"ABA"}, {id:"2",name:"Europa",sourceCode:"EUR"}];
const context={user,client:{slug:"ampedia",name:"Ampedia",schema:"ampedia"},
 clients:[{slug:"ampedia",name:"Ampedia"}],role:"superadministrador",pharmacies,
 modules:{dashboard:true,ventas:true,compras:true,proveedores:true,promociones:false}};
const profiles=[
 {profileId:1,key:"administrador",name:"Administrador",baseRole:"administrador",modules:null,sections:null,
  permissions:{ventas:["ver","editar"],compras:["ver","editar"]},system:true,userCount:0},
 {profileId:2,key:"farmacia",name:"Personal de farmacia",baseRole:"farmacia",modules:["ventas"],
  sections:["ventas-tickets"],permissions:{ventas:["ver"]},system:true,userCount:1},
 {profileId:3,key:"colaborador",name:"Colaborador",baseRole:"colaborador",modules:["compras"],
  sections:["compras-preparador"],permissions:{compras:["ver"]},system:true,userCount:1}
];
let stored=[
 {email:"empleado@example.invalid",name:"Empleado",role:"farmacia",profileId:2,profileName:"Personal de farmacia",
  pharmacies:["1"],active:true,authType:"google"},
 {email:"plantilla@example.invalid",name:"Plantilla",role:"colaborador",profileId:3,profileName:"Colaborador",
  pharmacies:["2"],active:true,authType:"google"}
];
const writes=[],errors=[];
page.on("pageerror",e=>errors.push(e.message));
await page.route("**/api/**",async route=>{
 const req=route.request(),path=new URL(req.url()).pathname;
 let body={};
 if(path==="/api/auth/me")body={user};
 else if(path==="/api/tenant/context")body=context;
 else if(path==="/api/tenant/farmacias")body=pharmacies;
 else if(path==="/api/tenant/perfiles")body=profiles;
 else if(path==="/api/tenant/usuarios"){
  if(req.method()==="PUT"){
   const next=req.postDataJSON();writes.push(next);
   const profile=profiles.find(p=>p.profileId===next.profileId);
   const record={...next,role:profile.baseRole,profileName:profile.name};
   stored=[...stored.filter(item=>item.email!==next.email),record];
   body=record;
  }else body=stored;
 }
 await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});
});
try{
 await page.goto("http://127.0.0.1:4175/usuarios",{waitUntil:"domcontentloaded"});
 await page.locator("h1").getByText("Usuarios",{exact:true}).waitFor({timeout:15000});
 await page.getByRole("button",{name:"Editar"}).first().waitFor({timeout:15000});
 assert.equal(await page.getByText("Secciones y subsecciones autorizadas").count(),0);
 await page.locator("tbody tr").filter({hasText:"empleado@example.invalid"}).getByRole("button",{name:"Editar"}).click();
 assert.equal(await page.getByLabel("Perfil",{exact:true}).inputValue(),"2");
 assert.equal(await page.getByRole("checkbox",{name:"Abadía"}).isChecked(),true);
 assert.equal(await page.getByRole("checkbox",{name:"Europa"}).isChecked(),false);
 await page.getByLabel("Perfil",{exact:true}).selectOption("3");
 await page.getByRole("checkbox",{name:"Europa"}).check();
 await page.getByRole("checkbox",{name:"Abadía"}).uncheck();
 await page.getByRole("button",{name:"Guardar cambios"}).click();
 await page.getByText("Usuario guardado con su perfil y farmacias.").waitFor();
 assert.equal(writes.at(-1).profileId,3);
 assert.deepEqual(writes.at(-1).pharmacies,["2"]);
 assert.equal("modules" in writes.at(-1),false);
 assert.equal("sections" in writes.at(-1),false);
 assert.equal(writes.at(-1).authType,"google");
 // Copiar perfil y farmacias no cambia identidad ni guarda hasta confirmar.
 await page.locator("tbody tr").filter({hasText:"empleado@example.invalid"}).getByRole("button",{name:"Editar"}).click();
 const source=page.getByLabel("Copiar perfil y farmacias de otro usuario (opcional)");
 const prior=writes.length;
 await source.selectOption("plantilla@example.invalid");
 assert.equal(writes.length,prior);
 assert.equal(await page.getByLabel("Perfil",{exact:true}).inputValue(),"3");
 assert.equal(await page.locator("input[type=email]").inputValue(),"empleado@example.invalid");
 await page.getByRole("button",{name:"Guardar cambios"}).click();
 assert.equal(writes.at(-1).email,"empleado@example.invalid");
 assert.equal(writes.at(-1).name,"Empleado");
 // Alta nueva: sólo perfil/farmacias, nunca módulos y subsecciones individuales.
 await page.locator("input[type=email]").fill("nuevo@example.invalid");
 await page.locator('input[placeholder="Nombre y apellidos"]').fill("Nuevo");
 await page.getByLabel("Copiar perfil y farmacias de otro usuario (opcional)")
  .selectOption("plantilla@example.invalid");
 await page.getByRole("button",{name:"Crear usuario"}).click();
 const created=writes.at(-1);
 assert.equal(created.email,"nuevo@example.invalid");
 assert.equal(created.profileId,3);
 assert.deepEqual(created.pharmacies,["2"]);
 assert.equal("modules" in created,false);
 assert.equal("sections" in created,false);
 assert.equal(errors.length,0,errors.join("\n"));
 console.log("OK perfiles globales: asignación, farmacias, copia y alta sin permisos individuales");
}finally{await browser.close()}
