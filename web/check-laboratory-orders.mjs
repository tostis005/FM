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
    {key:"N:CINFA",name:"Laboratorios Cinfa S.A.",hasMedication:true,hasParapharmacy:false},
    {key:"N:ERROR",name:"Laboratorio con ventas inaccesibles",hasMedication:true,hasParapharmacy:false}]};
 else if(path==="/api/analytics/pedidos/borrador-laboratorio"){
  if(request.method()==="PUT"){
   const data=request.postDataJSON();saved.push(data);
   body={saved:true,count:data.lineas.length,updatedAt:"2026-10-24T07:00:00Z"};
  }else body={lineas:[]};
 }else if(path==="/api/analytics/pedidos/catalogo-directo"){
  if(url.searchParams.get("laboratorio")==="N:CINFA")
   await new Promise(resolve=>setTimeout(resolve,600));
  body={rows:[{referencia:"790321",cn:"790321",nombre:"Producto recuperado del maestro",
   tipo:"medicacion",inMaster:true,inReceipts:false}],total:1,page:1,size:40};
 }else if(path==="/api/analytics/pedidos/diagnostico-laboratorio"){
  body={pharmacyCount:2,sources:[{type:"medicacion",status:"ok",total:1},
   {type:"parafarmacia",status:"ok",total:0}]};
 }else if(path==="/api/analytics/pedidos/matriz-laboratorio"){
  if(url.searchParams.get("laboratorio")==="N:CINFA")
   await new Promise(resolve=>setTimeout(resolve,1600));
  if(url.searchParams.get("laboratorio")==="N:ERROR"){
   await route.fulfill({status:503,contentType:"application/json",
    body:JSON.stringify({error:"El cálculo de ventas no está disponible"})});return;
  }
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
 await page.getByRole("combobox",{name:"Seleccionar laboratorio"}).fill("Laboratorio Ejemplo");
 await page.getByRole("option",{name:"Laboratorio Ejemplo"}).click();
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
 const labSelector=page.getByRole("combobox",{name:"Seleccionar laboratorio"});
 assert.equal(await labSelector.count(),1,"un único campo integrado para buscar y seleccionar");
 await labSelector.fill("Cinfa");
 assert.equal(await page.locator(".fm-lab-dropdown").getByRole("option").count(),1,"el desplegable filtra laboratorios por nombre");
 await page.getByRole("option",{name:"Laboratorios Cinfa S.A."}).click();
 await page.getByText(/Consultando artículos y códigos nacionales/).waitFor({timeout:1200});
 await page.getByText(/Calculando ventas y stock por farmacia/).waitFor({timeout:3000});
 const medicineTab=page.getByRole("tab",{name:/Medicación/});
 assert.equal(await medicineTab.getAttribute("aria-selected"),"true","Cinfa solo con medicamentos abre Medicación");
 await page.getByText("Medicamento").first().waitFor({timeout:15000});
  await page.getByRole("combobox",{name:"Seleccionar laboratorio"}).fill("ventas inaccesibles");
 await page.getByRole("option",{name:"Laboratorio con ventas inaccesibles"}).click();
 await page.getByText("Producto recuperado del maestro").first().waitFor({timeout:15000});
 await page.getByText(/No se pudieron calcular ventas\/stock/).waitFor();
 assert.equal(await page.getByRole("button",{name:"Guardar borrador"}).isDisabled(),true,
   "No se deben guardar propuestas sin stock y ventas verificadas");
  // Reproducción del defecto real: la vista antigua tenía dos cajas.
  await page.evaluate(()=>sessionStorage.setItem("fm_preparador_vista:ampedia","legacy"));
  await page.goto("http://127.0.0.1:4175/compras-preparador",{waitUntil:"domcontentloaded"});
  assert.equal(await page.getByRole("button",{name:"Pedido por laboratorio"}).getAttribute("aria-pressed"),"true",
   "Una preferencia guardada de la vista vieja no debe reabrirla");
  await page.goto("http://127.0.0.1:4175/compras-preparador?vista=anterior",{waitUntil:"domcontentloaded"});
  const catalog=page.locator(".fm-laboratory-catalog");
  await catalog.waitFor();
  const catalogPicker=catalog.getByRole("combobox",{name:"Seleccionar laboratorio del catálogo"});
  assert.equal(await catalogPicker.count(),1,"El catálogo antiguo también usa una sola caja");
  assert.equal(await catalog.locator("select").count(),0,"No hay un desplegable separado");
  await catalogPicker.fill("Cinfa");
  assert.equal(await catalog.getByRole("option",{name:"Laboratorios Cinfa S.A."}).count(),1,
   "Se filtran los laboratorios en el mismo desplegable");
  await catalog.getByRole("option",{name:"Laboratorios Cinfa S.A."}).click();
  assert.equal(await catalogPicker.inputValue(),"Laboratorios Cinfa S.A.");
  assert.equal(await catalogPicker.getAttribute("aria-expanded"),"false");
  assert.equal(errors.length,0,errors.join("\n"));
 console.log("OK preparador por laboratorio: matriz, para conjunta, medicación individual, borradores y XLSX");
}finally{await browser.close();}
