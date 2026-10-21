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
const posts=[],errors=[];
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
 else if(path==="/api/analytics/catalogos/proveedores")body={items:[
  {code:"P44",name:"Laboratorio Alfa"},{code:"P55",name:"Cooperativa Beta"}]};
 else if(path==="/api/analytics/pedidos/laboratorios"){
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
 }
 else if(path==="/api/analytics/pedidos/propuesta"){
  const id=url.searchParams.get("buscar")||"";
  const g={key:"CN:123456",cn:"123456",articleName:"Crema de manos",
   stock:10,unitsPeriod:24,units3:90,units12:300,suggested:8,
   patron:"recurrente",firstSale:"2026-03-05",lastSale:"2026-10-18",saleSpanDays:228,
   pharmacies:[
    {pharmacyId:"1",articleId:"771",articleName:"Crema de manos",cn:"123456",
     unitsPeriod:12,units3:45,units12:150,stock:6,suggested:3,ordered:0,
     daily:0.5,interval:7,lead:2,safety:0,policyDefault:false,
     firstSale:"2026-03-05",lastSale:"2026-10-18",saleSpanDays:228,
     demandPattern:"recurrente",confidence:"calculable"},
    {pharmacyId:"2",articleId:"999",articleName:"Crema de manos",cn:"123456",
     unitsPeriod:12,units3:45,units12:150,stock:4,suggested:5,ordered:0,
     daily:0.5,interval:7,lead:2,safety:0,policyDefault:false,
     firstSale:"2026-03-05",lastSale:"2026-10-18",saleSpanDays:228,
     demandPattern:"recurrente",confidence:"calculable"}]};
  const pageNumber=Number(url.searchParams.get("pagina")||1);
  const other={...g,key:"CN:654321",cn:"654321",articleName:"Gel de prueba",
   patron:"concentrada",firstSale:"2026-08-11",lastSale:"2026-08-13",saleSpanDays:3,suggested:0,
   pharmacies:g.pharmacies.map(p=>({...p,articleName:"Gel de prueba",cn:"654321"}))};
  body={available:true,groups:id&&id!=="123456"?[]:pageNumber===2?[other]:[g],
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
 await page.getByRole("button",{name:"Este mes"}).waitFor();
 await page.getByText(/Nueva propuesta por laboratorio/).waitFor();
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
 await pageTwo;
 await page.getByText("Gel de prueba").first().waitFor();
 await page.getByText("Ventas concentradas").first().waitFor();
 await page.getByText(/3 días de intervalo/).first().waitFor();
 const pageOne=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/analytics/pedidos/propuesta"
  &&new URL(r.url()).searchParams.get("pagina")==="1");
 await page.getByRole("button",{name:"Anterior"}).click();
 await pageOne;
 await page.getByText("Crema de manos").first().waitFor();
 await page.getByText("Recurrente").first().waitFor();
 await page.getByRole("button",{name:/Crema de manos/}).first().click();
 await page.getByRole("columnheader",{name:"Farmacia"}).first().waitFor();
 await page.getByText("Laboratorio Alfa").first().waitFor();
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
 assert.deepEqual(errors,[]);
 console.log("OK: Preparador consolidado, desglose por farmacia, proveedor y borradores guardados");
}finally{await browser.close()}
