import assert from "node:assert/strict";
import {chromium} from "playwright";
const BASE=process.env.RESPONSIVE_BASE_URL||"http://127.0.0.1:4175";
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1100,height:820}});
const user={email:"qa.traspasos@example.invalid",name:"QA",role:"superadministrador"};
const pharmacies=[{id:"1",name:"Farmacia origen",sourceCode:"ABA",databaseCode:"ABA",active:true}];
const supplier={id:"91",sourceCode:"INT1",name:"Farmacia receptora",
 type:"otros",active:true,cooperative:false,ignoreReports:true};
let previewCalls=0,saved=[],errors=[];
page.on("pageerror",e=>errors.push(e.message));
await page.route("**/api/**",async route=>{
 const req=route.request(),url=new URL(req.url()),p=url.pathname,m=req.method();
 let status=200,body={};
 if(p==="/api/auth/me")body={user};
 else if(p==="/api/tenant/context")body={user,role:"superadministrador",
  client:{slug:"ampedia",name:"Ampedia",schema:"ampedia"},
  modules:{proveedores:true},pharmacies,
  clients:[{slug:"ampedia",name:"Ampedia"}],allowedPharmacyIds:[1]};
 else if(p==="/api/tenant/farmacias")body=pharmacies;
 else if(p==="/api/tenant/proveedores")body=[supplier];
 else if(p==="/api/tenant/proveedores/traspasos-salidas"){
  if(m==="PUT"){
   const payload=req.postDataJSON();
   assert.equal(payload.confirmed,true);
   assert.equal(payload.customerId,"99");
   assert.equal(payload.supplierCode,"INT1");
   saved=[{pharmacyId:String(payload.pharmacyId),supplierCode:"INT1",customerId:"99"}];
   body=saved[0];
  }else if(m==="DELETE"){
   saved=[];body={deleted:true};
  }else body=saved;
 }
 else if(p==="/api/tenant/proveedores/traspasos-salidas/preview"){
  previewCalls++;const input=req.postDataJSON();
  assert.equal(String(input.pharmacyId),"1");assert.equal(input.customerId,"99");
  body={pharmacyId:"1",customerId:"99",from:input.from,to:input.to,documents:1,
   units:5,bySaleType:[{saleType:"tipo_venta:2",documents:1,units:5}]};
 }
 await route.fulfill({status,contentType:"application/json",body:JSON.stringify(body)});
});
try{
 await page.goto(BASE+"/proveedores-maestro",{waitUntil:"domcontentloaded"});
 await page.getByRole("heading",{name:"Traspasos salientes entre farmacias"}).waitFor({timeout:13000});
 await page.getByRole("combobox",{name:"Proveedor ignorado en compras"}).selectOption("INT1");
 await page.getByRole("combobox",{name:"Farmacia que registra la salida"}).selectOption("1");
 await page.getByRole("textbox",{name:"ID del cliente destinatario en Farmatic"}).fill("99");
 await page.getByRole("button",{name:/Comprobar movimientos/}).click();
 await page.getByRole("heading",{name:/Vista previa/}).waitFor({timeout:7000});
 assert.equal(previewCalls,1);
 assert.equal(await page.getByRole("button",{name:"Activar exclusión de salidas"}).isDisabled(),true);
 await page.getByRole("checkbox",{name:/Confirmo en Farmatic/}).check();
 await page.getByRole("button",{name:"Activar exclusión de salidas"}).click();
 await page.getByText(/Correspondencia activada/).waitFor({timeout:7000});
 assert.equal(saved.length,1);
 await page.getByText(/Cliente ERP 99 → proveedor INT1/).waitFor();
 page.once("dialog",dialog=>dialog.accept());
 await page.getByRole("button",{name:"Desactivar"}).click();
 await page.getByText(/Correspondencia eliminada/).waitFor({timeout:7000});
 assert.equal(saved.length,0);
 assert.deepEqual(errors,[]);
 console.log("OK: vista previa read-only, confirmación explícita, activación y revocación");
}finally{await browser.close()}
