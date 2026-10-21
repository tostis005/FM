import {chromium} from "playwright";
import assert from "node:assert/strict";
const BASE=process.env.RESPONSIVE_BASE_URL||"http://127.0.0.1:4175";
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1280,height:850}});
const requests=[];
const user={email:"qa@example.invalid",role:"superadministrador",name:"QA"};
const pharmacies=[{id:"1",name:"Farmacia Centro",sourceCode:"ABA",active:true}];
const modules=Object.fromEntries(["ventas","compras","stock","proveedores","rentabilidad","acciones","dashboard"].map(x=>[x,true]));
await page.route("**/api/**",async route=>{
 const url=new URL(route.request().url()),path=url.pathname;
 let body={};
 if(path==="/api/auth/me")body={user};
 else if(path==="/api/tenant/context")body={user,
   client:{slug:"ampedia",name:"Ampedia",schema:"ampedia"},role:"superadministrador",
   clients:[{slug:"ampedia",name:"Ampedia"}],pharmacies,modules};
 else if(path==="/api/tenant/promociones")body={promotions:[]};
 else if(path==="/api/tenant/farmacias")body=pharmacies;
 else if(path==="/api/analytics/pantallas/ventas-tickets/lineas"){
  body={lines:[
    {lineId:"1",articleId:"ART-01",units:2,unitPrice:6,discount:5,discountType:"porcentaje",amount:12,historicalCost:2},
    {lineId:"2",articleId:"ART-02",units:1,unitPrice:3,discount:0,amount:3,historicalCost:1}
   ],truncated:false};
 }
 else if(path.startsWith("/api/analytics/pantallas/")){
  const section=path.split("/").at(-1),q=url.searchParams;
  requests.push({section,query:Object.fromEntries(q.entries())});
  const sample={
   "ventas-tickets":{ticket:"T-REAL",at:"2026-10-18T12:00:00Z",pharmacyName:"Farmacia Centro",
     lines:2,units:3,amount:15,sellerId:"E1",sellerName:"Marga Abadía"},
   "ventas-devoluciones":{reference:"DEV-REAL",at:"2026-10-18T12:00:00Z",
     pharmacyName:"Farmacia Centro",article:"ART-01",units:-1,amount:-4,kind:"Devolución"},
   "compras-devoluciones":{reference:"ALB-REAL",at:"2026-10-18T12:00:00Z",
     pharmacyName:"Farmacia Centro",article:"ART-01",supplier:"PR1",supplierName:"Cooperativa Centro",units:-3,amount:-6},
   "productos":{cn:"654321",sourceId:"ART-01",name:"Omeprazol real",
     family:"Digestivo",laboratory:"Lab A",pharmacyName:"Farmacia Centro",
     pvp:8,pmc:2.5,stock:4},
   "proveedores-condiciones":{supplierCode:"PR1",supplierName:"Proveedor de prueba",
     pharmacyName:"Farmacia Centro",products:2,units:12,receipts:3,
     amount:30,lastAt:"2026-10-18T00:00:00Z"},
   "rentabilidad-segmentos":{family:"Digestivo",sales:32,units:4,coveredSales:32,
     margin:12,costedReferences:2,references:2},
   "stock-historico":{at:"2026-10-17",pharmacyName:"Farmacia Centro",
     pharmacyId:"1",soldUnits:3,receivedUnits:10,documentedNetUnits:7,tickets:2,receipts:1}
  }[section];
  body={section,available:true,total:section==="ventas-tickets"?33:1,
   page:Number(q.get("pagina")),pageSize:Number(q.get("tamano")),
   summary:{value:32,units:4,other:1},rows:[sample]};
 }
 await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});
});
try{
 for(const [path,text] of [
  ["ventas-tickets","T-REAL"],
  ["ventas-devoluciones","DEV-REAL"],
  ["compras-devoluciones","ALB-REAL"],
  ["productos","Omeprazol real"],
  ["proveedores-condiciones","Proveedor de prueba"],
  ["rentabilidad-segmentos","Digestivo"]
 ]){
  await page.goto(BASE+"/"+path,{waitUntil:"domcontentloaded"});
  await page.getByText(text,{exact:true}).first().waitFor({timeout:15000});
  assert.equal(await page.getByText("Pantalla de demostración").count(),0,path);
  assert.equal(await page.getByText("Ver ejemplo de demo").count(),0,path);
  assert.ok(requests.some(r=>r.section===path),path+" debe consultar la API real");
 }
 await page.goto(BASE+"/compras-devoluciones",{waitUntil:"domcontentloaded"});
 await page.getByText("Cooperativa Centro",{exact:true}).waitFor();
 await page.goto(BASE+"/ventas-tickets",{waitUntil:"domcontentloaded"});
 await page.getByText("T-REAL",{exact:true}).waitFor();
 await page.getByText("Marga Abadía",{exact:true}).waitFor();
 await page.getByRole("button",{name:"Ver líneas"}).first().click();
 await page.getByRole("region",{name:"Desglose del ticket"}).getByText("ART-01").waitFor();
 assert.equal(await page.getByRole("region",{name:"Desglose del ticket"}).locator("tbody tr").count(),2);
 await page.getByRole("region",{name:"Desglose del ticket"}).getByText("porcentaje").waitFor();
 await page.getByRole("button",{name:"Cerrar detalle"}).click();

 const before=requests.length;
 await page.getByRole("button",{name:"Siguiente",exact:true}).click();
 await page.waitForFunction(()=>document.querySelector(".list-pagination")?.textContent.includes("Página 2"));
 assert.ok(requests.length>before);
 assert.equal(requests.at(-1).query.pagina,"2","paginación en servidor");
 await page.getByRole("button",{name:/Venta neta/}).click();
 await page.waitForTimeout(350);
 assert.equal(requests.at(-1).query.orden,"amount","orden global en API");
 const after=requests.length;
 await page.evaluate(()=>{
  document.dispatchEvent(new Event("visibilitychange"));
  window.dispatchEvent(new Event("focus"));
 });
 await page.waitForTimeout(350);
 assert.equal(requests.length,after,"recuperar foco no debe recargar la tabla");
 // La última sección con maqueta muestra movimientos de documentos completos.
 await page.goto(BASE+"/stock-historico",{waitUntil:"domcontentloaded"});
 await page.getByRole("heading",{name:"Histórico de stock",exact:true}).waitFor({timeout:15000});
 await page.getByRole("columnheader",{name:/Variación documental/}).waitFor();
 await page.getByText(/No representa el stock histórico/).waitFor();
 assert.ok(requests.some(r=>r.section==="stock-historico"),
  "El histórico consulta el origen documental");
 assert.equal(await page.locator(".fm-preview-heading .fm-preview-badge").count(),0);
 assert.equal(await page.getByText("Pantalla de demostración").count(),0);
 const messages=await page.locator("main").innerText();
 assert.doesNotMatch(messages,/datos reales|datos de prueba/i);
 // Un intervalo personalizado incorrecto debe invalidar la tabla antigua.
 await page.goto(BASE+"/ventas-tickets",{waitUntil:"domcontentloaded"});
 await page.getByText("T-REAL",{exact:true}).waitFor();
 await page.locator(".fm-unified-filters select").first().selectOption("custom");
 const inputs=page.locator(".fm-unified-filters input[type=date]");
 await inputs.nth(0).fill("2026-10-21");
 await inputs.nth(1).fill("2026-10-01");
 await page.getByRole("alert").first().waitFor({timeout:6000});
 assert.equal(await page.getByText("T-REAL",{exact:true}).count(),0,
  "Un rango incorrecto no puede seguir mostrando tickets antiguos");
 console.log("OK: pantallas finales con consultas persistidas; histórico documental sin cifras de ejemplo");
}finally{await browser.close();}
