// Auditoría real de la tabla consolidada, explicación del cálculo y borradores por proveedor.
import {chromium} from "playwright";
import assert from "node:assert/strict";
const BASE=process.env.RESPONSIVE_BASE_URL||"http://127.0.0.1:4175";
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1280,height:850},acceptDownloads:true});
const user={email:"planner-qa@example.invalid",name:"QA",role:"superadministrador"};
const pharmacies=[{id:"1",name:"Farmacia Centro",sourceCode:"ABA",databaseCode:"ABA"},
 {id:"2",name:"Farmacia Norte",sourceCode:"NOR",databaseCode:"NOR"}];
const context={user,clients:[{slug:"ampedia",name:"Ampedia"}],
 client:{slug:"ampedia",schema:"ampedia",name:"Ampedia"},role:"superadministrador",
 pharmacies,modules:{compras:true,dashboard:true}};
const posts=[],errors=[],laboratoryRequests=[],stockWrites=[];
// Comprobar geometría real: ninguna columna debe pintar texto encima de otra.
async function verifyPlannerColumns(width){
 await page.setViewportSize({width,height:812});
 const result=await page.locator(".fm-planner-main-table").evaluate(table=>{
  const header=[...table.tHead.rows[0].cells].map(x=>{
   const b=x.getBoundingClientRect();return {left:b.left,right:b.right,width:b.width}
  });
  const row=[...table.tBodies[0].rows].find(r=>!r.classList.contains("fm-expanded-row"));
  const cells=[...row.cells].map(x=>{
   const b=x.getBoundingClientRect();return {left:b.left,right:b.right}
  });
  const content=[row.cells[0].querySelector(".fm-planner-article"),
   row.cells[1].querySelector(".fm-planner-lab-choice")].filter(Boolean).map(el=>{
   const b=el.getBoundingClientRect(),parent=el.closest("td").getBoundingClientRect();
   return {left:b.left,right:b.right,cellLeft:parent.left,cellRight:parent.right};
  });
  const scroll=table.closest(".table-scroll");
  return {tableWidth:table.getBoundingClientRect().width,header,cells,content,
   canScroll:scroll?.scrollWidth>scroll?.clientWidth};
 });
 assert.equal(result.header.length,8,"La tabla principal mantiene sus 8 columnas");
 assert.ok(result.tableWidth>=1200,"La tabla no debe reducir su ancho de seguridad");
 for(const parts of [result.header,result.cells])
  for(let i=1;i<parts.length;i++)
   assert.ok(parts[i].left>=parts[i-1].right-1,
    "Se montan columnas "+i+" y "+(i+1)+" en viewport "+width+"px");
 for(const c of result.content)
  assert.ok(c.left>=c.cellLeft-1&&c.right<=c.cellRight+1,
   "Contenido de producto o laboratorio sale de su columna a "+width+"px");
 if(width<1200)assert.ok(result.canScroll,"Falta scroll horizontal a "+width+"px");
}

page.on("pageerror",e=>errors.push(e.message));
await page.route("**/api/**",async route=>{
 const request=route.request(),url=new URL(request.url()),path=url.pathname;
 let body={};
 if(path==="/api/auth/me")body={user};
 else if(path==="/api/tenant/context")body=context;
 else if(path==="/api/tenant/farmacias")body=pharmacies;
 else if(path==="/api/operativa"&&request.method()==="GET")
  body={scope:{canEdit:true,canApprove:true},items:[]};
 else if(path==="/api/operativa"&&request.method()==="POST"){
  posts.push(request.postDataJSON());
  body={item:{id:"1b3e8f19-5949-4834-9561-5de41248c72e"}};
 }
 else if(path==="/api/tenant/stock-objetivo"&&request.method()==="GET")
  body={defaultDays:90,items:[{pharmacyId:1,days:90,configured:false},
   {pharmacyId:2,days:90,configured:false}]};
 else if(path==="/api/tenant/stock-objetivo"&&request.method()==="PUT"){
  stockWrites.push(request.postDataJSON());body={days:stockWrites.at(-1).days,updatedPharmacies:[1,2]};
 }
 else if(path==="/api/analytics/catalogos/proveedores")body={items:[
  {code:"P44",name:"Laboratorio Alfa"},{code:"P55",name:"Cooperativa Beta"}]};
 else if(path==="/api/analytics/pedidos/laboratorios"){
  const payload=request.postDataJSON();
  laboratoryRequests.push(payload);
  // Reproducir el servidor: sin farmacias el PUC nunca se encuentra.
  // El móvil sin filtro previo debe enviar las dos farmacias autorizadas.
  if(!payload?.pharmacies?.length){
   await route.fulfill({status:200,contentType:"application/json",
    body:JSON.stringify({recommendations:[],byPharmacy:[],presentations:[],observedPrices:0})});
   return;
  }
  body={recommendations:[{groupKey:"CN:123456",recommended:{
   groupKey:"CN:123456",pharmacyId:"1",articleId:"771",cn:"123456",
   supplierCode:"P44",supplierName:"Laboratorio Alfa",puc:3.24,sampleLines:4}}],
   byPharmacy:[{groupKey:"CN:123456",pharmacyId:"1",
    recommended:{supplierCode:"P44",supplierName:"Laboratorio Alfa",articleId:"771",cn:"123456",puc:3.24},
    options:[{supplierCode:"P44",supplierName:"Laboratorio Alfa",articleId:"771",cn:"123456",puc:3.24}]},
    {groupKey:"CN:123456",pharmacyId:"2",
    recommended:{supplierCode:"P44",supplierName:"Laboratorio Alfa",articleId:"999",cn:"123456",puc:3.52},
    options:[{supplierCode:"P44",supplierName:"Laboratorio Alfa",articleId:"999",cn:"123456",puc:3.52}]}],
   presentations:[{cn:"123456",dcpf:"10001",name:"Crema",laboratory:"Laboratorio Alfa"}]};
  if((request.postDataJSON()?.dcpfs||[]).includes("17531000140106")){
   body={recommendations:[{groupKey:"DCPF:17531000140106",
    recommended:{supplierName:"Proveedor 0005 (nombre pendiente)",supplierIdentified:false,
     cn:"662026",puc:1.201,sampleLines:5},
    options:[{supplierName:"Proveedor 0005 (nombre pendiente)",supplierIdentified:false,
     cn:"662026",puc:1.201,sampleLines:5}]}],
    byPharmacy:[],
    presentations:[{cn:"726064",dcpf:"17531000140106",
      name:"PARACETAMOL TEVAGEN 1000 MG COMPRIMIDOS EFG",
      titular:"LABORATORIOS TEVA S.L.U.",titularCode:"1234",
      commercializer:"TEVA PHARMA S.L.U.",commercializerCode:"5678"},
     {cn:"662026",dcpf:"17531000140106",name:"PARACETAMOL 1000 MG COMPRIMIDOS EFG",
      titularCode:"1234",commercializerCode:"5678"}]};
  }
 }
 else if(path==="/api/analytics/pedidos/propuesta"){
  const id=url.searchParams.get("buscar")||"";
  const g={key:"CN:123456",kind:"articulo",cn:"123456",articleName:"Crema de manos",
   stock:10,unitsPeriod:24,units3:90,units12:300,suggested:8,
   patron:"recurrente",firstSale:"2026-03-05",lastSale:"2026-10-18",saleSpanDays:228,
   pharmacies:[
    {pharmacyId:"1",groupKey:"CN:123456",articleId:"771",articleName:"Crema de manos",cn:"123456",
     options:[{articleId:"771",articleName:"Crema de manos",cn:"123456"}],
     unitsPeriod:12,units3:45,units12:150,stock:6,suggested:3,ordered:0,
     daily:0.5,interval:7,lead:2,safety:0,policyDefault:false,
     firstSale:"2026-03-05",lastSale:"2026-10-18",saleSpanDays:228,
     demandPattern:"recurrente",confidence:"calculable"},
    {pharmacyId:"2",groupKey:"CN:123456",articleId:"999",articleName:"Crema de manos",cn:"123456",
     options:[{articleId:"999",articleName:"Crema de manos",cn:"123456"}],
     unitsPeriod:12,units3:45,units12:150,stock:4,suggested:5,ordered:0,
     daily:0.5,interval:7,lead:2,safety:0,policyDefault:false,
     firstSale:"2026-03-05",lastSale:"2026-10-18",saleSpanDays:228,
     demandPattern:"recurrente",confidence:"calculable"}]};
  const pageNumber=Number(url.searchParams.get("pagina")||1);
  const other={...g,key:"CN:654321",cn:"654321",articleName:"Gel de prueba",
   patron:"concentrada",firstSale:"2026-08-11",lastSale:"2026-08-13",saleSpanDays:3,suggested:0,
   pharmacies:g.pharmacies.map(p=>({...p,articleName:"Gel de prueba",cn:"654321"}))};
  const generic={...g,key:"DCPF:17531000140106",kind:"generico",dcpf:"17531000140106",
   cn:null,articleName:"Genérico · Paracetamol 1000 mg comprimidos",
   pharmacies:g.pharmacies.map(p=>({...p,groupKey:"DCPF:17531000140106",
    cn:"726064",options:[{articleId:p.articleId,articleName:"Paracetamol EFG",cn:"726064"}]}))};
  body={available:true,groups:id==="paracetamol"?[generic]:
   id&&id!=="123456"?[]:pageNumber===2?[other]:[g],
   totalGroups:100,page:pageNumber,pageSize:50,
   summary:{unitsPeriod:240,units3:900,units12:3000,stockKnown:100,
    stockMissing:0,suggestedKnown:80,suggestedMissing:0,products:100,referenceCount:150},
   truncated:false,pharmacies};
 }
 await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});
});
try{
 await page.goto(BASE+"/compras-preparador",{waitUntil:"domcontentloaded"});
 await page.getByRole("heading",{name:"Preparador de pedidos"}).waitFor({timeout:15000});
 await page.getByText("Crema de manos").first().waitFor({timeout:15000});
 assert.equal(await page.getByText(/Nueva propuesta por laboratorio/).count(),0);
 assert.equal(await page.getByRole("columnheader",{name:"Demanda"}).count(),0,
  "La columna Demanda ya no debe mostrarse");
 const width=await page.locator(".fm-planner .smart-table thead th").first()
  .evaluate(el=>Math.round(el.getBoundingClientRect().width));
 assert.ok(width<=210,"La columna Producto / genérico debe ser compacta: "+width+"px");
 await verifyPlannerColumns(1280);
 await verifyPlannerColumns(768);
 await verifyPlannerColumns(375);
 await page.setViewportSize({width:1280,height:850});

 await page.getByRole("button",{name:"Este mes"}).waitFor();
 assert.equal(await page.getByText(/Nueva propuesta por laboratorio/).count(),0);
 assert.equal(await page.locator(".fm-unified-header select[aria-label=\"Farmacia\"]").count(),0,"La cabecera no debe imponer una farmacia");
 assert.ok(await page.getByText("Farmacias",{exact:true}).first().isVisible(),"Las farmacias se filtran en la caja común");
 const periodResponse=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/analytics/pedidos/propuesta");
 await page.getByRole("button",{name:"Esta semana"}).click();
 await periodResponse;
 assert.equal(await page.getByRole("button",{name:"Esta semana"}).getAttribute("aria-pressed"),"true");

 const dropdown=page.locator(".fm-unified-filters select").first();
 assert.ok((await dropdown.locator("option").allTextContents()).includes("Todo el histórico"));
 assert.ok((await page.getByText("240").first().isVisible()),"Los indicadores vienen del resumen total, no de la página");
 const pageTwo=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/analytics/pedidos/propuesta"
  &&new URL(r.url()).searchParams.get("pagina")==="2");
 await page.getByRole("button",{name:"Siguiente"}).click();
 const pageTwoRes=await pageTwo;
 const pageTwoData=await pageTwoRes.json();
 await page.getByText("Gel de prueba").first().waitFor();
 assert.equal(pageTwoData.groups[0].patron,"concentrada",
  "La detección de demanda se conserva en API aunque no se muestre la columna");
 assert.equal(await page.getByRole("columnheader",{name:"Demanda"}).count(),0);
 const pageOne=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/analytics/pedidos/propuesta"
  &&new URL(r.url()).searchParams.get("pagina")==="1");
 await page.getByRole("button",{name:"Anterior"}).click();
 const pageOneRes=await pageOne;
 assert.equal((await pageOneRes.json()).groups[0].patron,"recurrente");
 await page.getByText("Crema de manos").first().waitFor();
 await page.getByRole("button",{name:/Crema de manos/}).first().click();
 await page.locator(".fm-planner-details").first().waitFor();
 await page.locator(".fm-planner-lab-choice strong").first().waitFor();
 assert.deepEqual(laboratoryRequests.at(-1).pharmacies,[1,2],
  "Sin filtro, la consulta PUC debe incluir ambas farmacias como la de ventas");
 const detail=page.locator(".fm-planner-details");
 const rows=detail.locator("tbody tr");
 assert.equal(await rows.count(),2,"Una fila de detalle por farmacia");
 await rows.nth(0).getByRole("button",{name:"Usar recomendado"}).click();
 await rows.nth(1).getByRole("button",{name:"Usar recomendado"}).click();
 assert.equal(await rows.nth(0).getByRole("combobox",{name:/Laboratorio en/}).inputValue(),"P44|771");
 assert.equal(await rows.nth(1).getByRole("combobox",{name:/Laboratorio en/}).inputValue(),"P44|999");
 await page.getByRole("button",{name:"Guardar borradores por proveedor"}).click();
 await page.waitForFunction(()=>document.body.textContent.includes("borradores guardados"),null,{timeout:15000});
 assert.equal(posts.length,2,"Una farmacia genera su borrador separado del resto");
 assert.deepEqual(posts.map(p=>p.farmacia).sort(),["1","2"]);
 assert.deepEqual(posts.map(p=>p.lineas[0].articulo).sort(),["771","999"]);
 assert.ok(posts.every(p=>p.lineas[0].asignaciones[0].proveedor==="P44"));
 const search=page.locator(".fm-unified-filter input[type=search]").first();
 await search.fill("paracetamol");
 await page.getByText("Genérico · Paracetamol 1000 mg comprimidos").first().waitFor();
 await page.getByText(/Proveedor 0005.*nombre pendiente/).first().waitFor();
 await page.getByRole("button",{name:/Genérico.*Paracetamol 1000 mg/}).first().click();
 await page.locator(".fm-planner-presentations summary").click();
 await page.locator(".fm-planner-presentations[open] thead th").filter({hasText:"Titular de autorización"}).first().waitFor({state:"visible"});
 await page.getByText("LABORATORIOS TEVA S.L.U.").first().waitFor();
 await page.getByText("TEVA PHARMA S.L.U.").first().waitFor();
 await page.getByText(/Código AEMPS 1234 · nombre no resuelto/).first().waitFor();
 assert.equal(await page.getByRole("columnheader",{name:"Fabricante oficial"}).count(),0);
 await page.getByText(/1,201.*€/).first().waitFor();
 assert.equal(await page.getByText("Genérico DCPF 17531000140106").count(),0,
  "No se debe mostrar el identificador numérico en lugar del genérico");
 // Simular navegador móvil nuevo: sin filtros previos compartidos.
 await page.setViewportSize({width:375,height:812});
 await page.reload({waitUntil:"domcontentloaded"});
 await page.getByText("Crema de manos").first().waitFor({timeout:15000});
 await page.getByText("Laboratorio Alfa").first().waitFor({timeout:15000});
 assert.deepEqual(laboratoryRequests.at(-1).pharmacies,[1,2],
  "En móvil, Todas las farmacias debe consultar PUC para ambas");
 await verifyPlannerColumns(375);
 await page.getByRole("button",{name:/Crema de manos/}).first().click();
 await page.locator(".fm-planner-details").first().waitFor();
 assert.equal(await page.getByText("Sin PUC de laboratorio en los últimos 12 meses").count(),0,
  "No presentar ausencia falsa de PUC en móvil cuando el proveedor tiene compras");
 // La nueva preferencia de stock debe guardarse desde Ajustes.
 await page.goto(BASE+"/ajustes",{waitUntil:"domcontentloaded"});
 await page.getByRole("heading",{name:"Días de stock objetivo"}).waitFor({timeout:15000});
 const daysInput=page.getByRole("spinbutton",{name:"Días de stock objetivo"});
 await daysInput.fill("28");
 await page.getByRole("button",{name:"Guardar días de stock"}).click();
 await page.getByText("Objetivo aplicado a todas las farmacias.").waitFor({timeout:15000});
 assert.deepEqual(stockWrites,[{pharmacyId:0,days:28}]);
 assert.deepEqual(errors,[]);
 console.log("OK: PUC móvil, preparado de pedidos y Ajustes de días de stock");
}finally{await browser.close()}
