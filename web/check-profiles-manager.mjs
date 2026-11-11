import {chromium} from "playwright";
import assert from "node:assert/strict";

const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const profiles=[
 {profileId:1,key:"administrador",name:"Administrador",baseRole:"administrador",
  modules:null,sections:null,permissions:{promociones:["ver","editar"]},
  system:true,userCount:1,usedOtherClient:false,editable:false,deletable:false},
 {profileId:2,key:"gestor",name:"Gestor",baseRole:"gestor",
  modules:["promociones"],sections:["promociones","seguimiento-global"],
  permissions:{promociones:["ver","crear","editar","exportar"]},
  system:true,userCount:1,usedOtherClient:false,editable:false,deletable:false},
 {profileId:3,key:"farmacia",name:"Personal de farmacia",baseRole:"farmacia",
  modules:["promociones","reposicion"],sections:["promociones","seguimiento-global","reposicion"],
  permissions:{promociones:["ver","exportar"],reposicion:["ver"]},
  system:true,userCount:2,usedOtherClient:false,editable:true,deletable:false}
];
const modules=[{id:"promociones",name:"Promociones"},{id:"reposicion",name:"Reposición"}];
const sections=[
 {id:"promociones",name:"Promociones",module:"promociones",profileVisible:true},
 {id:"seguimiento-global",name:"Seguimiento",module:"promociones",profileVisible:true},
 {id:"reposicion",name:"Reposición",module:"reposicion",profileVisible:false}
];
const scope={modules:["promociones"],sections:["promociones","seguimiento-global"],
 operations:{promociones:["ver","crear","editar","exportar"]}};
const pharmacies=[{id:"1",name:"Farmacia de prueba",sourceCode:"ABC"}];
const errors=[],writes=[];

async function checkRole(role){
 const page=await browser.newPage({viewport:{width:1260,height:820}});
 page.on("pageerror",e=>errors.push(e.message));
 const user={role,email:"perfil-"+role+"@example.invalid",name:"Perfil de pruebas"};
 const context={user,role,client:{slug:"ampedia",name:"Ampedia",schema:"ampedia"},
  clients:[{slug:"ampedia",name:"Ampedia"}],pharmacies,
  modules:{promociones:true},sections:{promociones:true,"seguimiento-global":true},
  profile:{id:2,name:"Gestor",permissions:{promociones:["ver","crear","editar","exportar"]}}};
 await page.route("**/api/**",async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;
  let body={};
  if(path==="/api/auth/me")body={user};
  else if(path==="/api/tenant/context")body=context;
  else if(path==="/api/tenant/farmacias")body=pharmacies;
  else if(path==="/api/tenant/perfiles/gestion"){
   body={profiles:profiles.map(p=>({...p,editable:role==="administrador"&&p.key==="gestor"?true:p.editable})),
    modules,sections,scope,level:role};
  }else if(path==="/api/tenant/perfiles/gestion/3"&&req.method()==="PUT"){
   writes.push({role,path,body:req.postDataJSON()});
   body={profileId:3,name:req.postDataJSON().name};
  }else if(path==="/api/tenant/perfiles")body=profiles;
  await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});
 });
 try{
  await page.goto("http://127.0.0.1:4175/perfiles",{waitUntil:"domcontentloaded"});
  await page.getByRole("heading",{name:"Perfiles de usuario"}).waitFor({timeout:15000});
  await page.getByRole("button",{name:"Perfiles",exact:true}).first().waitFor();
  const administrator=page.locator(".fm-profile-card").filter({hasText:"Administrador"});
  const manager=page.locator(".fm-profile-card").filter({hasText:"Gestor"});
  assert.equal(await administrator.getByText("Solo lectura").count(),1);
  if(role==="gestor")assert.equal(await manager.getByText("Solo lectura").count(),1);
  assert.equal(await page.locator(".fm-profile-card").getByRole("button",{name:"Eliminar"}).count(),0);
  await page.locator(".fm-profile-card").filter({hasText:"Personal de farmacia"})
   .getByRole("button",{name:"Configurar"}).click();
  assert.equal(await page.locator(".fm-profile-module").filter({hasText:"Reposición"}).count(),0);
  await page.locator("#editar-perfil input").first().fill("Personal actualizado");
  await page.getByRole("button",{name:"Guardar perfil"}).click();
  await page.getByText("Perfil guardado. Los usuarios asignados ya utilizan esta configuración.").waitFor();
  assert.equal(writes.at(-1).role,role);
  assert.equal(writes.at(-1).path,"/api/tenant/perfiles/gestion/3");
  assert.equal(writes.at(-1).body.name,"Personal actualizado");
  assert.deepEqual(writes.at(-1).body.modules,["promociones","reposicion"]);
  assert.deepEqual(writes.at(-1).body.sections,["promociones","seguimiento-global","reposicion"]);
 }finally{await page.close();}
}

try{
 await checkRole("gestor");
 await checkRole("administrador");
 assert.equal(errors.length,0,errors.join("\n"));
 console.log("OK perfiles: Gestor y Administrador ven menú, editan personal y no eliminan perfiles base");
}finally{await browser.close();}
