import {chromium} from "playwright";
import assert from "node:assert/strict";

const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1280,height:820}});
const user={email:"warehouse-ci@example.invalid",name:"Administrador",role:"superadministrador"};
const warehouse={id:"6",name:"Almacén central",city:"",active:true,sourceCode:"ALMACEN",displayCode:"ALM",
 sourceHost:"10.1.2.3",sourceDatabase:"Farmatic",establishmentType:"almacen"};
const pharmacy={id:"1",name:"Farmacia Abadía",city:"",active:true,sourceCode:"ABA",
 sourceHost:"",sourceDatabase:"Farmatic",establishmentType:"farmacia"};
const context={user,role:"superadministrador",client:{slug:"ampedia",name:"Ampedia",schema:"ampedia"},
 clients:[{slug:"ampedia",name:"Ampedia"}],pharmacies:[pharmacy],
 establishments:[pharmacy,warehouse],
 modules:{dashboard:true,stock:true,ventas:true,compras:true}};
let saved=[],errors=[];
page.on("pageerror",e=>errors.push(e.message));
await page.route("**/api/**",async route=>{
 const req=route.request(),path=new URL(req.url()).pathname,method=req.method();
 let json={};
 if(path==="/api/auth/me")json={user};
 else if(path==="/api/tenant/context")json=context;
 else if(path==="/api/tenant/farmacias")json=[pharmacy];
 else if(path==="/api/tenant/establecimientos")json=[pharmacy,warehouse];
 else if(path==="/api/tenant/establecimientos/6"&&method==="PATCH"){
  const data=req.postDataJSON();
  saved.push({path,data});
  warehouse.name=data.name;
  json={id:"6",name:warehouse.name,sourceCode:"ALMACEN",establishmentType:"almacen"};
 }else if(method==="PATCH"&&path==="/api/tenant/farmacias/6"){
  throw Error("El almacén no se puede guardar por la ruta de farmacias");
 }
 await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(json)});
});
try{
 await page.goto("http://127.0.0.1:4175/farmacias",{waitUntil:"domcontentloaded"});
 await page.getByText("Farmacias y almacén central").waitFor({timeout:15000});
 const warehouseRow=page.locator(".list-card tbody tr").filter({hasText:"Almacén central"}).first();
 await warehouseRow.waitFor();
 await warehouseRow.click();
 await page.getByRole("heading",{name:"Editar almacén"}).waitFor();
 assert.equal(await page.getByLabel("ID del almacén").inputValue(),"6");
 assert.equal(await page.getByRole("textbox",{name:"Nombre público",exact:true}).inputValue(),"Almacén central");
 assert.equal(await page.getByRole("textbox",{name:"Código visible",exact:true}).inputValue(),"ALM");
 assert.equal(await page.getByText(/El ID y el código de sincronización/).count(),1);
 assert.equal(await page.locator(".drawer input[value='ALMACEN']").count(),0,
  "No se puede modificar el código interno del almacén");
 assert.equal(await page.getByLabel("Host/IP SQL Server").count(),0);
 await page.getByRole("textbox",{name:"Nombre público",exact:true}).fill("ALM");
 await page.getByRole("button",{name:"Guardar cambios"}).click();
 await page.getByText("Nombre y código visible del almacén actualizados").waitFor();
 assert.deepEqual(saved,[{path:"/api/tenant/establecimientos/6",data:{name:"ALM",displayCode:"ALM"}}]);
 assert.equal(warehouse.sourceCode,"ALMACEN","El sincronizador mantiene su origen");
 assert.equal(warehouse.sourceHost,"10.1.2.3","No cambia el servidor SQL");
 await page.locator(".list-card tbody tr").filter({hasText:"ALM"}).first().waitFor();
 assert.deepEqual(errors,[]);
 console.log("OK: almacén editable como ALM, identidad y origen de sincronización inmutables");
}finally{await browser.close();}
