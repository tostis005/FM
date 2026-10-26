// Regresión: el maestro unifica proveedores Farmatic, sin Nomenclátor.
import {chromium} from "playwright";
import assert from "node:assert/strict";
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1280,height:820}});
const user={email:"supplier-ci@example.invalid",role:"superadministrador"};
const pharmacies=[{id:"1",name:"Abadía",sourceCode:"ABA",databaseCode:"ABA"}];
const context={user,client:{slug:"ampedia",name:"Ampedia",schema:"ampedia"},
 clients:[{slug:"ampedia",name:"Ampedia"}],role:"superadministrador",
 pharmacies,modules:{dashboard:true,compras:true,proveedores:true}};
let master=[
 {id:"1",key:"P:1",name:"Laboratorio Uno",class:"DIRECTO",
  origins:[{pharmacyCode:"ABA",sourceCode:"0001",sourceName:"Lab uno Farmatic"}]},
 {id:"2",key:"P:2",name:"Cooperativa Dos",class:"MAYORISTA",
  origins:[{pharmacyCode:"ABA",sourceCode:"0040",sourceName:"Coop dos"}]}
];
const erp=[
 {sourceCode:"0001",name:"Lab uno Farmatic",origins:[{pharmacyId:"1",name:"Lab uno Farmatic",source:"farmatic"}]},
 {sourceCode:"0040",name:"Coop dos",origins:[{pharmacyId:"1",name:"Coop dos",source:"farmatic"}]},
 {sourceCode:"0320",name:"Laboratorio Nuevo",origins:[{pharmacyId:"1",name:"Laboratorio Nuevo",source:"farmatic"}]}
];
const errors=[],updates=[],links=[];
page.on("pageerror",e=>errors.push(e.message));
await page.route("**/api/**",async route=>{
 const req=route.request(),url=new URL(req.url()),path=url.pathname;
 let body={};
 if(path==="/api/auth/me")body={user};
 else if(path==="/api/tenant/context")body=context;
 else if(path==="/api/tenant/farmacias")body=pharmacies;
 else if(path==="/api/tenant/proveedores")body=erp;
 else if(path==="/api/tenant/proveedores-unificados"&&req.method()==="GET")body=master;
 else if(/^\/api\/tenant\/proveedores-unificados\/\d+$/.test(path)&&req.method()==="PUT"){
  const id=path.split("/").at(-1),data=req.postDataJSON();
  updates.push({id,...data});master=master.map(p=>p.id===id?{...p,...data}:p);
  body={id,...data};
 }else if(path.endsWith("/origen")&&req.method()==="PUT"){
  const id=path.split("/").at(-2),data=req.postDataJSON();
  links.push({id,...data});
  master=master.map(p=>p.id===id?{...p,origins:[...p.origins,
   {pharmacyCode:data.pharmacyCode,sourceCode:data.sourceCode,sourceName:data.sourceName}]}:p);
  body={saved:true};
 }else if(req.method()==="GET")body=[];
 await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});
});
try{
 await page.goto("http://127.0.0.1:4175/proveedores-maestro",{waitUntil:"domcontentloaded"});
 await page.getByRole("heading",{name:"Maestro único de proveedores"}).waitFor({timeout:15000});
 await page.getByText("Laboratorio Uno").first().waitFor();
 assert.equal(await page.getByText("Cooperativa Dos").first().count(),1);
 await page.getByRole("button",{name:"Editar"}).first().click();
 const dlg=page.getByRole("dialog",{name:"Editar proveedor"});
 await dlg.getByLabel("Clasificación").selectOption("INTERNO");
 await dlg.getByRole("button",{name:"Guardar"}).click();
 await page.getByText("Proveedor actualizado").waitFor();
 assert.equal(updates[0].class,"INTERNO");
 await page.getByRole("button",{name:"Relacionar"}).first().click();
 const linkDialog=page.getByRole("dialog",{name:"Relacionar código ERP"});
 await linkDialog.getByLabel("Proveedor de destino").selectOption("1");
 await linkDialog.getByRole("button",{name:"Guardar equivalencia"}).click();
 await page.getByText("Código ERP vinculado").waitFor();
 assert.equal(links[0].sourceCode,"0320");
 assert.equal(links[0].pharmacyCode,"ABA");
 assert.equal(links[0].id,"1");
 assert.equal(errors.length,0,errors.join("\n"));
 console.log("OK maestro: clasificación, equivalencias locales y exclusión de Nomenclátor");
}finally{await browser.close()}
