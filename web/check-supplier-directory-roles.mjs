// Cobertura real de lectura/gestión y botonera responsive del directorio.
import assert from "node:assert/strict";
import {chromium} from "playwright";
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const base=process.env.RESPONSIVE_BASE_URL||"http://127.0.0.1:4175";
const supplier={id:"1",key:"P:1",name:"Laboratorio Demo",class:"DIRECTO",origins:[
 {pharmacyCode:"ABA",sourceCode:"L1",sourceName:"Laboratorio Demo"}]};
const pharmacies=[{id:"1",name:"Farmacia Demo",sourceCode:"ABA",databaseCode:"ABA",active:true}];
async function setup(role,moduleEnabled=true){
 const page=await browser.newPage({viewport:{width:375,height:800}});
 const errors=[];page.on("pageerror",e=>errors.push(e.message));
 const user={email:"test-"+role+"@example.invalid",name:"Pruebas",role};
 await page.route("**/api/**",async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;
  let body={},status=200;
  if(path==="/api/auth/me")body={user};
  else if(path==="/api/tenant/context")body={user,role,
   client:{slug:"ampedia",name:"Ampedia",schema:"ampedia",analysisMonths:12},
   clients:[{slug:"ampedia",name:"Ampedia"}],
   modules:{proveedores:moduleEnabled},sections:{proveedores:role==="superadministrador"||moduleEnabled,"proveedores-condiciones":moduleEnabled},pharmacies,allowedPharmacyIds:[1]};
  else if(path==="/api/tenant/proveedores-unificados")body=[supplier];
  else if(path==="/api/tenant/proveedores")body=[{sourceCode:"L1",name:"Laboratorio Demo",
   origins:[{pharmacyId:"1",name:"Laboratorio Demo",source:"farmatic"}]}];
  else if(path==="/api/tenant/farmacias")body=pharmacies;
  else if(path==="/api/tenant/pedidos/frecuencias")body={items:[]};
  else if(path==="/api/tenant/proveedor-documento-categorias")body=[{id:"1",name:"Tarifas",active:true}];
  else if(path==="/api/tenant/proveedores-unificados/1/ficha")body={
   supplier:{...supplier,active:true},profile:{phone:"600 000 000"},erp:{},
   categories:[{id:"1",name:"Tarifas",active:true}],
   contacts:[{id:"1",name:"Ana",surname:"Pérez",position:"Delegada",email:"ana@example.invalid",phone:"600 000 000",notes:"",primary:true}],
   documents:[{id:"2",name:"Tarifa 2026",fileName:"tarifa.pdf",categoryId:"1",category:"Tarifas",mime:"application/pdf",version:"2",
    createdAt:"2026-10-01",documentDate:"2026-10-01",notes:"",size:100}],
   erpRecords:[],canManage:["gestor","administrador","superadministrador"].includes(role)};
  else if(path==="/api/tenant/proveedores-unificados/1/documentos/2/descargar"){
   await route.fulfill({status:200,contentType:"application/octet-stream",
    headers:{"Content-Disposition":'attachment; filename="tarifa.pdf"'},body:"PDF de prueba"});
   return;
  }
  await route.fulfill({status,contentType:"application/json",body:JSON.stringify(body)});
 });
 return {page,errors};
}
try{
 const reader=await setup("farmacia",true);
 await reader.page.goto(base+"/proveedores",{waitUntil:"domcontentloaded"});
 await reader.page.getByRole("heading",{name:"Directorio de proveedores"}).waitFor({timeout:15000});
 assert.equal(await reader.page.getByRole("navigation",{name:"Módulos"})
  .getByRole("button",{name:"Proveedores",exact:true}).count(),1);
 assert.equal(await reader.page.getByRole("button",{name:"Análisis de proveedores"}).count(),0);
 assert.equal(await reader.page.getByRole("button",{name:"Configurar categorías documentales"}).count(),0);
 assert.equal(await reader.page.getByRole("combobox",{name:/Tipo de Laboratorio Demo/}).count(),0);
 assert.equal(await reader.page.getByRole("button",{name:"Nuevo proveedor"}).count(),0);
 assert.equal(await reader.page.getByRole("tab",{name:/Sin vincular/}).count(),0);
 await reader.page.getByRole("button",{name:"Ver ficha y documentos"}).click();
 await reader.page.getByRole("heading",{name:"Laboratorio Demo"}).waitFor();
 await reader.page.getByText("Ana Pérez").first().waitFor();
 await reader.page.getByText("Tarifa 2026").first().waitFor();
 for(const name of ["Nuevo contacto","Subir documento","Configurar categorías","Guardar ficha"]){
  assert.equal(await reader.page.getByRole("button",{name}).count(),0,"Un lector no debe ver "+name);
 }
 assert.equal(await reader.page.getByRole("button",{name:"Descargar"}).count(),1);
 const downloadWait=reader.page.waitForEvent("download");
 await reader.page.getByRole("button",{name:"Descargar"}).click();
 assert.equal((await downloadWait).suggestedFilename(),"tarifa.pdf");
 assert.deepEqual(reader.errors,[]);
 await reader.page.close();

 const collaborator=await setup("colaborador",true);
 await collaborator.page.goto(base+"/proveedores",{waitUntil:"domcontentloaded"});
 await collaborator.page.getByRole("heading",{name:"Directorio de proveedores"}).waitFor({timeout:15000});
 await collaborator.page.getByRole("button",{name:"Ver ficha y documentos"}).click();
 await collaborator.page.getByText("Ana Pérez").first().waitFor();
 assert.equal(await collaborator.page.getByRole("button",{name:"Nuevo contacto"}).count(),0);
 assert.equal(await collaborator.page.getByRole("button",{name:"Subir documento"}).count(),0);
 assert.deepEqual(collaborator.errors,[]);
 await collaborator.page.close();

 const superadmin=await setup("superadministrador",false);
 await superadmin.page.goto(base+"/proveedores",{waitUntil:"domcontentloaded"});
 await superadmin.page.getByRole("heading",{name:"Maestro de proveedores"}).waitFor({timeout:15000});
 assert.equal(await superadmin.page.getByRole("navigation",{name:"Módulos"})
  .getByRole("button",{name:"Proveedores",exact:true}).count(),1,
  "El superadministrador debe ver Proveedores aun cuando el módulo esté deshabilitado");
 await superadmin.page.getByRole("button",{name:"Ver ficha y documentos"}).click();
 await superadmin.page.getByRole("heading",{name:"Laboratorio Demo"}).waitFor();
 assert.equal(await superadmin.page.getByRole("button",{name:"Nuevo contacto"}).count(),1);
 assert.deepEqual(superadmin.errors,[]);
 await superadmin.page.close();
 
 const manager=await setup("gestor",true);
 await manager.page.goto(base+"/proveedores-maestro",{waitUntil:"domcontentloaded"});
 await manager.page.getByRole("heading",{name:"Maestro de proveedores"}).waitFor({timeout:15000});
 const categoryButton=manager.page.getByRole("button",{name:"Configurar categorías documentales"});
 await categoryButton.waitFor();
 assert.equal(await manager.page.getByRole("button",{name:"Nuevo proveedor"}).count(),1);
 assert.equal(await manager.page.getByRole("combobox",{name:/Tipo de Laboratorio Demo/}).count(),1);
 const bounds=await categoryButton.evaluate(button=>{
  const span=button.querySelector("span"),outer=button.getBoundingClientRect(),inner=span.getBoundingClientRect();
  return {outerWidth:button.clientWidth,scrollWidth:button.scrollWidth,left:inner.left-outer.left,
   right:outer.right-inner.right,bodyWidth:document.documentElement.scrollWidth,
   viewportWidth:document.documentElement.clientWidth};
 });
 assert.ok(bounds.scrollWidth<=bounds.outerWidth+2,"Desbordamiento del botón Categorías: "+JSON.stringify(bounds));
 assert.ok(bounds.left>=0&&bounds.right>=0,"Texto fuera del botón Categorías: "+JSON.stringify(bounds));
 assert.ok(bounds.bodyWidth<=bounds.viewportWidth+5,"Desbordamiento global en móvil: "+JSON.stringify(bounds));
 await categoryButton.click();
 await manager.page.getByRole("heading",{name:"Categorías documentales"}).waitFor();
 assert.equal(await manager.page.getByRole("button",{name:/Añadir categoría/}).count(),1);
 assert.deepEqual(manager.errors,[]);
 await manager.page.close();
 console.log("OK: con módulo Proveedores, farmacia y colaboradores consultan y descargan; gestores configuran, móvil correcto");
}finally{await browser.close()}
