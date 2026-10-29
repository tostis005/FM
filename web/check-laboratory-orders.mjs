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
const saved=[],matrices=[],labQueries=[],catalogCalls=[],errors=[];
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
 else if(path==="/api/analytics/pedidos/proveedores-unificados"){
  labQueries.push(Object.fromEntries(url.searchParams));
  body={laboratories:[{key:"P:10",name:"Laboratorio Ejemplo",class:"DIRECTO"},
   {key:"P:11",name:"Laboratorios Cinfa S.A.",class:"DIRECTO",hasMedication:true,hasParapharmacy:false},
   {key:"P:12",name:"Laboratorio con 125 referencias",class:"DIRECTO"},
   {key:"P:13",name:"Laboratorio con ventas inaccesibles",class:"DIRECTO",hasMedication:true,hasParapharmacy:false}]};
 }
 else if(path==="/api/analytics/pedidos/borrador-laboratorio"){
  if(request.method()==="PUT"){
   const data=request.postDataJSON();saved.push(data);
   body={saved:true,count:data.lineas.length,updatedAt:"2026-10-24T07:00:00Z"};
  }else body={lineas:[]};
 }else if(path==="/api/analytics/pedidos/catalogo-directo"||
  path==="/api/analytics/pedidos/catalogo-unificado"){
  const requestedLab=url.searchParams.get("laboratorio"),type=url.searchParams.get("tipo");
  catalogCalls.push({lab:requestedLab,type});
  const lab={"P:10":"C:LAB","P:11":"N:CINFA","P:12":"N:MULTI","P:13":"N:ERROR"}[requestedLab]||requestedLab;
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
  path==="/api/analytics/pedidos/matriz-referencias"||
  path==="/api/analytics/pedidos/matriz-conjunta"){
  const incoming=request.method()==="POST"?request.postDataJSON():null;
  const requestedLab=incoming?.laboratorio||url.searchParams.get("laboratorio");
  const lab={"P:10":"C:LAB","P:11":"N:CINFA","P:12":"N:MULTI","P:13":"N:ERROR"}[requestedLab]||requestedLab;
  if(lab==="N:CINFA")await new Promise(resolve=>setTimeout(resolve,850));
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
  "El selector consulta el maestro unificado por farmacia");
 await page.getByRole("combobox",{name:"Seleccionar laboratorio"}).fill("Laboratorio Ejemplo");
 await page.getByRole("option",{name:"Laboratorio Ejemplo"}).click();
 await page.getByRole("tab",{name:/Parafarmacia/}).waitFor();
 try{await page.getByText("Crema solar").first().waitFor({timeout:9000})}
 catch(e){
  console.error("LAB ORDER DEBUG",JSON.stringify({matrices,errors,body:(await page.locator("body").innerText()).slice(0,2800)}));
  throw e;
 }
 assert.equal(await page.getByRole("button",{name:"Vista anterior"}).count(),0,
  "Ya no se ofrece el preparador antiguo");
 assert.equal(await page.locator(".fm-lab-order-tabs .btn").count(),2,
  "Parafarmacia y Medicación son botones con el diseño principal");
 assert.equal(await page.locator(".fm-lab-order-tabs .btn-primary").count(),1);
 assert.equal(await page.getByLabel("Desde",{exact:true}).count(),1);
 assert.equal(await page.getByLabel("Hasta",{exact:true}).count(),1);
 assert.equal(await page.getByRole("group",{name:"Períodos rápidos"}).count(),0);
 // Filtrar referencias nunca debe provocar nueva consulta de catálogo ni ventas.
 const beforeSearch=catalogCalls.length,beforeSales=matrices.length;
 await page.getByRole("searchbox",{name:"Buscar artículo o CN"}).fill("crema");
 await page.waitForTimeout(450);
 assert.equal(catalogCalls.length,beforeSearch);
 assert.equal(matrices.length,beforeSales);
 await page.getByRole("searchbox",{name:"Buscar artículo o CN"}).fill("");
 // Rango elegido para V. período incluso cuando el preset era "Este mes".
 await page.getByLabel("Desde",{exact:true}).fill("2025-06-01");
 await page.getByLabel("Hasta",{exact:true}).fill("2025-08-31");
 await page.waitForTimeout(650);
 assert.ok(matrices.some(m=>m.desde==="2025-06-01"&&m.hasta==="2025-08-31"),
  "El preparador envía el período de verano pasado a la matriz");
 await page.getByRole("combobox",{name:"Ventas · período seleccionado"}).selectOption("this_month");
 await page.waitForTimeout(600);
 assert.equal(await page.locator(".fm-lab-order-group").count(),2);
 assert.equal(await page.locator(".fm-lab-order-sub").count(),10);
 assert.equal((await page.locator(".fm-lab-order-table thead th.fm-lab-order-editcol").textContent()).trim(),
  "Pedir total");
 assert.doesNotMatch(await page.locator(".fm-lab-order").innerText(),/Pedia|Ampedia/i,
  "El preparador no debe mostrar nombres del operador en títulos de pedido");
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
 const medicineTotal=page.getByRole("spinbutton",{name:"Pedir total de Medicamento"});
 assert.equal(await medicineTotal.inputValue(),"10");
 await input1.fill("4");
 assert.equal(await medicineTotal.inputValue(),"11","El total refleja cambios por farmacia");
 await page.getByRole("button",{name:"Guardar borrador"}).click();
 await page.getByText(/Borrador guardado/).waitFor();
 assert.equal(saved.at(-1).tipo,"medicacion");
 assert.deepEqual(saved.at(-1).lineas[0].unitsByPharmacy,{"1":4,"2":7});
 await medicineTotal.fill("22");
 assert.equal(await input1.inputValue(),"8","La edición del total reparte proporcionalmente");
 assert.equal(await input2.inputValue(),"14");
 await page.getByRole("button",{name:"Guardar borrador"}).click();
 await page.getByText(/Borrador guardado/).waitFor();
 assert.deepEqual(saved.at(-1).lineas[0].unitsByPharmacy,{"1":8,"2":14},
  "El total editable se guarda como desglose de medicación por farmacia");
 const file2=page.waitForEvent("download");
 await page.getByRole("button",{name:"Generar Excel"}).click();
 assert.match((await file2).suggestedFilename(),/medicacion\.xlsx$/);
 const labSelector=page.getByRole("combobox",{name:"Seleccionar laboratorio"});
 assert.equal(await labSelector.count(),1,"un único campo integrado para buscar y seleccionar");
 await labSelector.fill("Cinfa");
 assert.equal(await page.locator(".fm-lab-dropdown").getByRole("option").count(),1,"el desplegable filtra laboratorios por nombre");
 await page.getByRole("option",{name:"Laboratorios Cinfa S.A."}).click();
 await page.getByText(/Cargando referencias/).waitFor({timeout:1200});
 await page.getByText(/Calculando ventas y stock/).first().waitFor({timeout:3000});
 const overlay=page.locator(".fm-lab-matrix-overlay");
 await overlay.waitFor({state:"visible",timeout:4000});
 const loadingState=await overlay.evaluate(node=>({
  message:node.innerText,
  busy:node.parentElement.querySelector(".fm-lab-order-scroll")?.getAttribute("aria-busy"),
  disabled:node.parentElement.querySelector("input[aria-label='Pedir total de Medicamento']")?.disabled
 }));
 assert.match(loadingState.message,/Calculando ventas y stock por farmacia/);
 assert.equal(loadingState.busy,"true");
 assert.equal(loadingState.disabled,true,
  "Las cantidades no se modifican mientras se muestran cálculos pendientes");
 await overlay.waitFor({state:"hidden",timeout:15000});
 assert.equal(await page.locator(".fm-lab-order-scroll").getAttribute("aria-busy"),"false");
 const medicineTab=page.getByRole("tab",{name:/Medicación/});
 assert.equal(await medicineTab.getAttribute("aria-selected"),"true","Cinfa solo con medicamentos abre Medicación");
 await page.getByText("Medicamento").first().waitFor({timeout:15000});
 const multiSelector=page.getByRole("combobox",{name:"Seleccionar laboratorio"});
 await multiSelector.fill("125 referencias");
 await page.getByRole("option",{name:"Laboratorio con 125 referencias"}).click();
 await page.getByText("Referencia lote 125").waitFor({timeout:25000});
 assert.equal(await page.locator(".fm-lab-order-table tbody tr").count(),125,
  "Todas las 125 referencias se ven a la vez, también las de otros lotes");
 // Los textos explicativos han desaparecido sin quitar funcionalidades.
 assert.equal(await page.locator(".fm-lab-order-period-help").count(),0);
 assert.equal(await page.locator(".fm-lab-order-top").getByText(/Nomenclátor por sí solo/i).count(),0);
 assert.equal(await page.locator(".fm-lab-order-summary").getByText(/en una sola tabla/i).count(),0);
 assert.match(await page.locator(".fm-lab-order-summary > span").first().innerText(),/referencias/);
 assert.equal(await page.locator(".fm-lab-order-table td.fm-lab-order-name small").count(),0);
 assert.equal((await page.locator(".fm-lab-order-actions").innerText()).trim()
  .replace(/\s+/g," "),"Guardar borrador Generar Excel Marcar pedido realizado");
 assert.equal(await page.locator(".fm-lab-order > .fm-op-fine").count(),0);
 // Cabecera fija durante scroll vertical de 125 artículos; CN y Artículo a la izquierda.
 const sticky=await page.locator(".fm-lab-order .fm-dual-scroll").evaluate(root=>{
  const top=root.querySelector(".fm-dual-scroll-top");
  const pane=root.querySelector(".fm-lab-order-scroll");
  const table=pane?.querySelector("table"),thead=table?.querySelector("thead");
  if(!top||!pane||!thead)return {ok:false,reason:"faltan contenedores"};
  const vertical=pane.scrollHeight>pane.clientHeight+80;
  const horizontal=pane.scrollWidth>pane.clientWidth+4;
  pane.scrollTop=600;pane.scrollLeft=200;
  pane.dispatchEvent(new Event("scroll",{bubbles:true}));
  const first=pane.querySelector("tbody tr td.fm-lab-order-cn")?.getBoundingClientRect();
  const second=pane.querySelector("tbody tr td.fm-lab-order-name")?.getBoundingClientRect();
  return {vertical,horizontal,scrollTop:pane.scrollTop,
   headerDelta:thead.getBoundingClientRect().top-pane.getBoundingClientRect().top,
   stickyPosition:getComputedStyle(thead).position,
   cnDelta:first?first.left-pane.getBoundingClientRect().left:null,
   nameDelta:second&&first?second.left-first.right:null,
   scrollLeft:pane.scrollLeft,topScrollLeft:top.scrollLeft,
   topVisible:top.getBoundingClientRect().height>0};
 });
 assert.ok(sticky.vertical&&sticky.horizontal&&sticky.scrollTop>100,
  "La matriz larga debe desplazarse vertical y horizontalmente: "+JSON.stringify(sticky));
 assert.equal(sticky.stickyPosition,"sticky");
 assert.ok(Math.abs(sticky.headerDelta)<=4,
  "La cabecera debe seguir visible: "+JSON.stringify(sticky));
 assert.ok(Math.abs(sticky.cnDelta)<=4&&Math.abs(sticky.nameDelta)<=5,
  "CN y artículo deben quedar fijos a la izquierda: "+JSON.stringify(sticky));
 assert.ok(sticky.topVisible&&Math.abs(sticky.scrollLeft-sticky.topScrollLeft)<=2,
  "Scroll superior debe seguir al inferior: "+JSON.stringify(sticky));
 const reverse=await page.locator(".fm-lab-order .fm-dual-scroll").evaluate(root=>{
  const top=root.querySelector(".fm-dual-scroll-top");
  const pane=root.querySelector(".fm-lab-order-scroll");
  top.scrollLeft=80;top.dispatchEvent(new Event("scroll",{bubbles:true}));
  return [top.scrollLeft,pane.scrollLeft];
 });
 assert.ok(Math.abs(reverse[0]-reverse[1])<=2,
  "Mover barra superior mueve las mismas columnas que el pie");
 assert.equal(await page.locator(".fm-lab-order-pager").count(),0);
 assert.equal(await page.getByRole("button",{name:"Siguiente",exact:true}).count(),0);
 const last=page.getByRole("spinbutton",{name:"Pedir Referencia lote 125 para el laboratorio"});
 await last.fill("9");
 const saveMulti=page.getByRole("button",{name:"Guardar borrador"});
 await saveMulti.waitFor({state:"visible"});
 await page.waitForFunction(()=>!document.querySelector(".fm-lab-order-actions button").disabled,{timeout:25000});
 assert.ok(matrices.some(m=>m.laboratorio==="P:12"&&m.referencias?.length===125),
  "Todas las referencias se calculan en una sola agregación");
 await saveMulti.click();
 await page.getByText(/Borrador guardado/).waitFor();
 assert.ok(matrices.some(m=>m.laboratorio==="P:12"&&m.referencias?.length===125));
 assert.equal(saved.at(-1).lineas.length,125,"El borrador incluye todo el laboratorio");
 assert.equal(saved.at(-1).lineas.find(l=>l.name==="Referencia lote 125")?.units,9);
  await page.getByRole("combobox",{name:"Seleccionar laboratorio"}).fill("ventas inaccesibles");
 await page.getByRole("option",{name:"Laboratorio con ventas inaccesibles"}).click();
 await page.getByText("Producto recuperado del maestro").first().waitFor({timeout:15000});
 await page.getByText(/no se pudieron completar las ventas y el stock/).waitFor();
 assert.equal(await page.getByRole("button",{name:"Guardar borrador"}).isDisabled(),true,
   "No se deben guardar propuestas sin stock y ventas verificadas");
  // Ni una preferencia antigua ni ?vista=anterior reactivan la versión obsoleta.
  await page.evaluate(()=>sessionStorage.setItem("fm_preparador_vista:ampedia","legacy"));
  await page.goto("http://127.0.0.1:4175/compras-preparador?vista=anterior",
   {waitUntil:"domcontentloaded"});
  await page.getByRole("combobox",{name:"Seleccionar laboratorio"}).waitFor();
  assert.equal(await page.getByRole("button",{name:"Vista anterior"}).count(),0);
  assert.equal(await page.locator(".fm-laboratory-catalog").count(),0);
  assert.ok(labQueries.every(q=>q.uso==="preparador"),
   "El selector por farmacia exige proveedores unificados");
  assert.equal(errors.length,0,errors.join("\n"));
 console.log("OK preparador por laboratorio: matriz, para conjunta, medicación individual, borradores y XLSX");
}finally{await browser.close();}
