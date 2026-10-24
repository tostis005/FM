// Prueba de navegador del preparador por laboratorio, sin datos de producción.
import {chromium} from "playwright";
import assert from "node:assert/strict";
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1366,height:900},acceptDownloads:true});
const pharmacies=[{id:"1",name:"Abadía",sourceCode:"ABA",databaseCode:"ABA"},
 {id:"2",name:"Europa",sourceCode:"EUR",databaseCode:"EUR"}];
const user={email:"lab-order-ci@example.invalid",role:"superadministrador",name:"CI"};
const context={user,clients:[{slug:"ampedia",name:"Ampedia"}],
 client:{slug:"ampedia",schema:"ampedia",name:"Ampedia"},
 role:"superadministrador",pharmacies,modules:{compras:true,dashboard:true,proveedores:true}};
const saved=[],matrices=[],errors=[];
page.on("pageerror",e=>errors.push(e.message));
await page.route("**/api/**",async route=>{
 const request=route.request(),url=new URL(request.url()),path=url.pathname;
 let body={};
 if(path==="/api/auth/me")body={user};
 else if(path==="/api/tenant/context")body=context;
 else if(path==="/api/tenant/farmacias")body=pharmacies;
 else if(path==="/api/operativa")body={scope:{canEdit:true,canApprove:true},items:[]};
 else if(path==="/api/analytics/pedidos/catalogo-laboratorios")
  body={laboratories:[{key:"C:LAB",name:"Laboratorio Ejemplo"},
    {key:"N:CINFA",name:"Laboratorios Cinfa S.A.",hasMedication:true,hasParapharmacy:false}]};
 else if(path==="/api/analytics/pedidos/articulos-laboratorio"){
   const cinfa=url.searchParams.get("laboratorio")==="N:CINFA";
   body=cinfa?{rows:[{referencia:"400123",cn:"400123",nombre:"Medicamento Cinfa",
    inMaster:true,inReceipts:false}],total:1,page:1,size:40}:{rows:[],total:0,page:1,size:40};
  }
 else if(path==="/api/analytics/pedidos/borrador-laboratorio"){
  if(request.method()==="PUT"){
   const data=request.postDataJSON();saved.push(data);
   body={saved:true,count:data.lineas.length,updatedAt:"2026-10-24T07:00:00Z"};
  }else body={lineas:[]};
 }else if(path==="/api/analytics/pedidos/matriz-laboratorio"){
   if(url.searchParams.get("laboratorio")==="N:CINFA")
    await new Promise(resolve=>setTimeout(resolve,2300));
  const type=url.searchParams.get("tipo");
  matrices.push(Object.fromEntries(url.searchParams));
  const med=type==="medicacion";
  const cn=med?"400123":"000123";
  body={rows:[{referencia:cn,cn,nombre:med?"Medicamento":"Crema solar",
   inMaster:true,inReceipts:true,provisional:false,
   byPharmacy:{
    "1":{stock:4,units3:30,units12:120,unitsPeriod:8,suggested:3,ordered:0},
    "2":{stock:6,units3:40,units12:160,unitsPeriod:5,suggested:7,ordered:0}
   },totalSold:13,totalSuggested:10}],total:1,page:1,size:40};
 }
 await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});
});
try{
 await page.goto("http://127.0.0.1:4175/compras-preparador",{waitUntil:"domcontentloaded"});
 await page.getByRole("combobox",{name:"Seleccionar laboratorio"}).selectOption("C:LAB");
 await page.getByRole("tab",{name:/Parafarmacia/}).waitFor();
 try{await page.getByText("Crema solar").first().waitFor({timeout:9000})}
 catch(e){
  console.error("LAB ORDER DEBUG",JSON.stringify({matrices,errors,body:(await page.locator("body").innerText()).slice(0,2800)}));
  throw e;
 }
 assert.equal(await page.locator(".fm-lab-order-group").count(),2);
 assert.equal(await page.locator(".fm-lab-order-sub").count(),10);
 const joint=page.getByRole("spinbutton",{name:"Pedir Crema solar para el laboratorio"});
 assert.equal(await joint.inputValue(),"10");
 await joint.fill("13");
 await page.getByRole("button",{name:"Guardar borrador"}).click();
 await page.getByText(/Borrador guardado/).waitFor();
 assert.equal(saved.at(-1).tipo,"parafarmacia");
 assert.equal(saved.at(-1).lineas[0].units,13);
 const file1=page.waitForEvent("download");
 await page.getByRole("button",{name:"Generar Excel"}).click();
 assert.match((await file1).suggestedFilename(),/parafarmacia\.xlsx$/);
 await page.getByRole("tab",{name:/Medicación/}).click();
 await page.getByText("Medicamento").first().waitFor();
 const input1=page.getByRole("spinbutton",{name:"Pedir Medicamento en Abadía"});
 const input2=page.getByRole("spinbutton",{name:"Pedir Medicamento en Europa"});
 assert.equal(await input1.inputValue(),"3");
 assert.equal(await input2.inputValue(),"7");
 await input1.fill("4");
 await page.getByRole("button",{name:"Guardar borrador"}).click();
 await page.getByText(/Borrador guardado/).waitFor();
 assert.equal(saved.at(-1).tipo,"medicacion");
 assert.deepEqual(saved.at(-1).lineas[0].unitsByPharmacy,{"1":4,"2":7});
 const file2=page.waitForEvent("download");
 await page.getByRole("button",{name:"Generar Excel"}).click();
 assert.match((await file2).suggestedFilename(),/medicacion\.xlsx$/);
 await page.getByRole("combobox",{name:"Seleccionar laboratorio"}).selectOption("N:CINFA");
 const medicineTab=page.getByRole("tab",{name:/Medicación/});
 assert.equal(await medicineTab.getAttribute("aria-selected"),"true","Cinfa solo con medicamentos abre Medicación");
 await page.getByText("Medicamento Cinfa").first().waitFor({timeout:1800});
 await page.getByText(/Artículos cargados · calculando ventas y stock/).waitFor({timeout:1800});
 await page.getByText("Medicamento").first().waitFor({timeout:15000});
  assert.equal(errors.length,0,errors.join("\n"));
 console.log("OK preparador por laboratorio: matriz, para conjunta, medicación individual, borradores y XLSX");
}finally{await browser.close();}
