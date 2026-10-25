// Prueba de navegador del preparador por laboratorio, sin datos de producción.
import {chromium} from "playwright";
import assert from "node:assert/strict";
import {collectLaboratoryCatalog} from "./src/laboratoryLoadAll.js";
// Prueba de varias tandas sin paginado ni omisiones de referencias.
const batchProgress=[];
const list=await collectLaboratoryCatalog(async(page,size)=>({
 total:205,rows:Array.from({length:205},(_,i)=>({
  referencia:"REF-"+(i+1)})).slice((page-1)*size,page*size)
}),{batchSize:100,onBatch:p=>batchProgress.push(p.loaded)});
assert.equal(list.rows.length,205);
assert.deepEqual(batchProgress,[100,200,205]);
await assert.rejects(()=>collectLaboratoryCatalog(async page=>({
 total:120,rows:page===1?Array.from({length:100},(_,i)=>({referencia:String(i)})):[]
}),{batchSize:100}),/página vacía/);
let inFlight=0,maxInFlight=0;
const parallelList=await collectLaboratoryCatalog(async(page,size)=>{
 inFlight++;maxInFlight=Math.max(maxInFlight,inFlight);
 await new Promise(resolve=>setTimeout(resolve,page===2?45:10));
 inFlight--;
 return {total:305,rows:Array.from({length:305},(_,i)=>({
  referencia:"BATCH-"+(i+1)})).slice((page-1)*size,page*size)};
},{batchSize:100,concurrency:3});
assert.equal(parallelList.rows.length,305);
assert.ok(maxInFlight>=2,"las tandas del catálogo se consultan en paralelo");
assert.deepEqual(parallelList.rows.map(x=>x.referencia).slice(99,102),
 ["BATCH-100","BATCH-101","BATCH-102"],"la tabla conserva el orden");
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1366,height:900},acceptDownloads:true});
const pharmacies=[{id:"1",name:"Abadía",sourceCode:"ABA",databaseCode:"ABA"},
 {id:"2",name:"Europa",sourceCode:"EUR",databaseCode:"EUR"}];
const user={email:"lab-order-ci@example.invalid",role:"superadministrador",name:"CI"};
const context={user,clients:[{slug:"ampedia",name:"Ampedia"}],
 client:{slug:"ampedia",schema:"ampedia",name:"Ampedia"},
 role:"superadministrador",pharmacies,modules:{compras:true,dashboard:true,proveedores:true}};
const saved=[],matrices=[],labQueries=[],errors=[];
page.on("pageerror",e=>errors.push(e.message));
await page.route("**/api/**",async route=>{
 const request=route.request(),url=new URL(request.url()),path=url.pathname;
 let body={};
 if(path==="/api/auth/me")body={user};
 else if(path==="/api/tenant/context")body=context;
 else if(path==="/api/tenant/farmacias")body=pharmacies;
 else if(path==="/api/operativa")body={scope:{canEdit:true,canApprove:true},items:[]};
 else if(path==="/api/analytics/pedidos/catalogo-laboratorios"){
  labQueries.push(Object.fromEntries(url.searchParams));
  body={laboratories:[{key:"C:LAB",name:"Laboratorio Ejemplo"},
    {key:"N:CINFA",name:"Laboratorios Cinfa S.A.",hasMedication:true,hasParapharmacy:false},
    {key:"N:MULTI",name:"Laboratorio con 125 referencias",hasMedication:false,hasParapharmacy:true},
    {key:"N:ERROR",name:"Laboratorio con ventas inaccesibles",hasMedication:true,hasParapharmacy:false}]};
 }
 else if(path==="/api/analytics/pedidos/borrador-laboratorio"){
  if(request.method()==="PUT"){
   const data=request.postDataJSON();saved.push(data);
   body={saved:true,count:data.lineas.length,updatedAt:"2026-10-24T07:00:00Z"};
  }else body={lineas:[]};
 }else if(path==="/api/analytics/pedidos/catalogo-directo"){
  const lab=url.searchParams.get("laboratorio"),type=url.searchParams.get("tipo");
  if(lab==="N:CINFA")await new Promise(resolve=>setTimeout(resolve,300));
  const pageNumber=Number(url.searchParams.get("pagina")||1);
  const limit=Number(url.searchParams.get("tamano")||40);
  let rows;
  if(lab==="N:MULTI")
   rows=Array.from({length:125},(_,i)=>({referencia:String(1000+i).padStart(6,"0"),
    cn:String(1000+i).padStart(6,"0"),nombre:"Referencia lote "+String(i+1).padStart(3,"0"),
    tipo:"parafarmacia",inMaster:false,inReceipts:true}));
  else if(lab==="N:ERROR")
   rows=[{referencia:"790321",cn:"790321",nombre:"Producto recuperado del maestro",
    tipo:"medicacion",inMaster:true,inReceipts:false}];
  else{
   const med=type==="medicacion";
   rows=[{referencia:med?"400123":"000123",cn:med?"400123":"000123",
    nombre:med?"Medicamento":"Crema solar",tipo:med?"medicacion":"parafarmacia",
    inMaster:true,inReceipts:true}];
  }
  body={rows:rows.slice((pageNumber-1)*limit,pageNumber*limit),total:rows.length,
   page:pageNumber,size:limit};
 }else if(path==="/api/analytics/pedidos/diagnostico-laboratorio"){
  body={pharmacyCount:2,sources:[{type:"medicacion",status:"ok",total:1},
   {type:"parafarmacia",status:"ok",total:0}]};
 }else if(path==="/api/analytics/pedidos/matriz-laboratorio"||
  path==="/api/analytics/pedidos/matriz-referencias"){
  const incoming=request.method()==="POST"?request.postDataJSON():null;
  const lab=incoming?.laboratorio||url.searchParams.get("laboratorio");
  if(lab==="N:CINFA")await new Promise(resolve=>setTimeout(resolve,300));
  if(lab==="N:ERROR"){
   await route.fulfill({status:503,contentType:"application/json",
    body:JSON.stringify({error:"El cálculo de ventas no está disponible"})});return;
  }
  const type=incoming?.tipo||url.searchParams.get("tipo");
  matrices.push(incoming||Object.fromEntries(url.searchParams));
  const med=type==="medicacion",pageNumber=Number(url.searchParams.get("pagina")||1);
  const limit=Number(url.searchParams.get("tamano")||40);
  const refs=incoming?.referencias||(lab==="N:MULTI"?
   Array.from({length:125},(_,i)=>({
    referencia:String(1000+i).padStart(6,"0"),
    cn:String(1000+i).padStart(6,"0"),
    nombre:"Referencia lote "+String(i+1).padStart(3,"0")
   })):
   [{referencia:med?"400123":"000123",cn:med?"400123":"000123",
    nombre:med?"Medicamento":"Crema solar"}]);
  const selected=incoming?refs:refs.slice((pageNumber-1)*limit,pageNumber*limit);
  body={rows:selected.map(r=>({...r,
   inMaster:lab!=="N:MULTI",inReceipts:true,provisional:false,
   byPharmacy:{
    "1":{stock:4,units3:30,units12:120,unitsPeriod:8,suggested:3,ordered:0},
    "2":{stock:6,units3:40,units12:160,unitsPeriod:5,suggested:7,ordered:0}
   },totalSold:13,totalSuggested:10
  })),total:refs.length,page:pageNumber,size:limit,frequencyDays:7};
 }
 await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});
});
try{
 await page.goto("http://127.0.0.1:4175/compras-preparador",{waitUntil:"domcontentloaded"});
 await page.waitForFunction(()=>document.querySelector(".fm-lab-order-chooser input")?.placeholder?.includes("Escribe"));
 assert.ok(labQueries.some(q=>q.uso==="preparador"&&q.farmacias==="1,2"),
  "El selector usa solo actividad operativa de las farmacias incluidas");
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
 await page.getByText(/Cargando referencias/).waitFor({timeout:1200});
 await page.getByText(/Calculando ventas y stock/).waitFor({timeout:3000});
 const medicineTab=page.getByRole("tab",{name:/Medicación/});
 assert.equal(await medicineTab.getAttribute("aria-selected"),"true","Cinfa solo con medicamentos abre Medicación");
 await page.getByText("Medicamento").first().waitFor({timeout:15000});
 const multiSelector=page.getByRole("combobox",{name:"Seleccionar laboratorio"});
 await multiSelector.fill("125 referencias");
 await page.getByRole("option",{name:"Laboratorio con 125 referencias"}).click();
 await page.getByText("Referencia lote 125").waitFor({timeout:25000});
 assert.equal(await page.locator(".fm-lab-order-table tbody tr").count(),125,
  "Todas las 125 referencias se ven a la vez, también las de otros lotes");
 assert.equal(await page.locator(".fm-lab-order-pager").count(),0);
 assert.equal(await page.getByRole("button",{name:"Siguiente",exact:true}).count(),0);
 const last=page.getByRole("spinbutton",{name:"Pedir Referencia lote 125 para el laboratorio"});
 await last.fill("9");
 const saveMulti=page.getByRole("button",{name:"Guardar borrador"});
 await saveMulti.waitFor({state:"visible"});
 await page.waitForFunction(()=>!document.querySelector(".fm-lab-order-actions button").disabled,{timeout:25000});
 assert.ok(matrices.filter(m=>m.laboratorio==="N:MULTI").length>=4,
  "Se calculan métricas para todos los lotes");
 await saveMulti.click();
 await page.getByText(/Borrador guardado/).waitFor();
 assert.equal(saved.at(-1).lineas.length,125,"El borrador incluye todo el laboratorio");
 assert.equal(saved.at(-1).lineas.find(l=>l.name==="Referencia lote 125")?.units,9);
  await page.getByRole("combobox",{name:"Seleccionar laboratorio"}).fill("ventas inaccesibles");
 await page.getByRole("option",{name:"Laboratorio con ventas inaccesibles"}).click();
 await page.getByText("Producto recuperado del maestro").first().waitFor({timeout:15000});
 await page.getByText(/no se pudieron completar las ventas y el stock/).waitFor();
 assert.equal(await page.getByRole("button",{name:"Guardar borrador"}).isDisabled(),true,
   "No se deben guardar propuestas sin stock y ventas verificadas");
  // Reproducción del defecto real: la vista antigua tenía dos cajas.
  await page.evaluate(()=>sessionStorage.setItem("fm_preparador_vista:ampedia","legacy"));
  await page.goto("http://127.0.0.1:4175/compras-preparador",{waitUntil:"domcontentloaded"});
  assert.equal(await page.getByRole("button",{name:"Pedido por laboratorio"}).getAttribute("aria-pressed"),"true",
   "Una preferencia guardada de la vista vieja no debe reabrirla");
  await page.goto("http://127.0.0.1:4175/compras-preparador?vista=anterior",{waitUntil:"domcontentloaded"});
  assert.ok(labQueries.every(q=>q.uso==="preparador"),
   "Ambos preparadores exigen laboratorios con datos de Farmatic");
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
