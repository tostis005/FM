import {chromium} from "playwright";
import assert from "node:assert/strict";

const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1320,height:820}});
const user={email:"picking-stock-ci@example.invalid",name:"Gestor CI",role:"usuario"};
const sites=[
 {id:"6",name:"Almacén central",code:"ALMACEN",kind:"almacen",ready:true},
 {id:"1",name:"Farmacia Abadía",code:"ABA",kind:"farmacia",ready:true},
 {id:"2",name:"Farmacia Buñol",code:"BUE",kind:"farmacia",ready:true}
];
const context={user,role:"gestor",client:{slug:"ampedia",name:"Ampedia",schema:"ampedia",analysisMonths:12},
 clients:[{slug:"ampedia",name:"Ampedia"}],
 pharmacies:[{id:"1",name:"Farmacia Abadía",sourceCode:"ABA"},
  {id:"2",name:"Farmacia Buñol",sourceCode:"BUE"}],
 modules:{stock:true},sections:{stock:true,"picking-list":true},
 profile:{id:2,name:"Gestor",permissions:{stock:["ver","editar","importar"]}}};
const stock=[
 {...sites[0],stock:4,planned:4,matched:true,stockAt:new Date().toISOString()},
 {...sites[1],stock:5,planned:3,matched:true,stockAt:new Date().toISOString()},
 {...sites[2],stock:3,planned:1,matched:true,stockAt:new Date().toISOString()}
];
let refreshed=false,refreshCalls=0;
const jsErrors=[];
page.on("pageerror",error=>jsErrors.push(error.message));
await page.route("**/api/**",async route=>{
 const req=route.request(),pathname=new URL(req.url()).pathname;
 let json={};
 if(pathname==="/api/auth/me")json={user};
 else if(pathname==="/api/tenant/context")json=context;
 else if(pathname==="/api/tenant/farmacias")json=context.pharmacies;
 else if(pathname==="/api/picking-list/refresh"){
  refreshCalls++;refreshed=true;json={ok:true,rows:2};
 }else if(pathname==="/api/picking-list/issues"){
  json={headers:["order_id","quantity","sku","title","Detalle CSV"],
   rows:[{line:7,reason:"producto sin SKU/CN",cells:["1003","2","","Producto B","texto, completo"]},
    {line:8,reason:"cantidad no válida",cells:["1004","xyz","123456","Producto C","observación"]}],
   total:2,offset:0,limit:25};
 }else if(pathname==="/api/picking-list/report"){
  const meta={sourceConfigured:true,lastImportedAt:refreshed?new Date().toISOString():null,
   lineCount:refreshed?2:0,sourceState:refreshed?"ok":"error",
   sourceError:refreshed?null:"Dropbox no ha permitido descargar el CSV.",
   stockLocations:3,stockLocationsReady:3,unmatchedProducts:0,
   lastWarning:refreshed?"2 filas no se han podido incluir en la preparación.":null};
  json={meta,sites,channels:refreshed?["web"]:[],selectedChannel:"",
   rows:refreshed?[{key:"123456",cn:"123456",sku:"123456",name:"Producto A",
    required:8,orders:2,lines:2,stock,allocated:8,shortage:0,
    status:"cubierto",stockTotal:12,exhausted:[],
    details:[{orderId:"1001",orderName:"#1001",channel:"web",createdAt:null,quantity:5},
     {orderId:"1002",orderName:"#1002",channel:"web",createdAt:null,quantity:3}]}]:[],
   totals:{orders:refreshed?1:0,lines:refreshed?2:0,
    units:refreshed?8:0,products:refreshed?1:0,
    allocated:refreshed?8:0,pending:0,shortage:0,incomplete:0}};
 }
 await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(json)});
});
try{
 await page.goto("http://127.0.0.1:4175/picking-list",{waitUntil:"domcontentloaded"});
 await page.getByRole("heading",{name:"Picking List",exact:true}).waitFor({timeout:15000});
 await page.getByText(/Dropbox configurado, pero no se han podido importar los pedidos/).waitFor();
 assert.equal(await page.getByText(/ubicaciones con artículos sincronizados/).count(),0);
 await page.getByRole("heading",{name:"Aún no se han importado pedidos de Dropbox"}).waitFor();
 assert.equal(await page.getByRole("button",{name:"Leer pedidos de Dropbox"}).count(),0);
 assert.equal(await page.getByRole("button",{name:"Actualizar",exact:true}).count(),0);
 // El sistema externo cambia el CSV. En la siguiente visita la API ya lo habrá
 // leído automáticamente: el usuario no debe pulsar ningún botón.
 refreshed=true;
 await page.reload({waitUntil:"domcontentloaded"});
 await page.getByRole("heading",{name:"Distribución de pedidos pendientes"}).waitFor();
 assert.equal(refreshCalls,0,"La UI no necesita invocar endpoints manuales");
 await page.getByText("Producto A",{exact:true}).waitFor();
 assert.equal(await page.getByText("Pedidos online pendientes").count(),0);
 assert.equal(await page.getByText("Pedidos pendientes de Shopify").count(),0);
 assert.equal(await page.getByText("Stock sin actualizar").count(),0);
 await page.getByText("Pedidos totales").waitFor();
 await page.getByText("Unidades totales").first().waitFor();
 await page.getByText("Total unidades disponibles").waitFor();
 await page.getByText("Unidades pendientes").first().waitFor();
 const headers=await page.locator(".fm-picking-table thead th").allTextContents();
 assert.ok(headers.some(x=>x.trim()==="Stock ABA"),
  "Se esperaba la columna Stock ABA: "+JSON.stringify(headers));
 assert.ok(headers.some(x=>x.trim()==="Unidades ABA"),
  "Se esperaba la columna Unidades ABA: "+JSON.stringify(headers));
 const lastStockIndex=headers.findLastIndex(x=>x.trim().startsWith("Stock "));
 const firstUnitsIndex=headers.findIndex(x=>x.trim().startsWith("Unidades ")&&x.trim()!=="Unidades totales");
 assert.ok(firstUnitsIndex>lastStockIndex,
  "Se esperaba agrupar stocks antes de unidades: "+JSON.stringify(headers));
 await page.getByRole("button",{name:"Ver más"}).click();
 await page.getByRole("heading",{name:"Filas del CSV que no se han importado"}).waitFor();
 const issueColumns=await page.locator(".fm-picking-issues thead th").allTextContents();
 assert.ok(issueColumns.some(x=>x.trim()==="Detalle CSV"),JSON.stringify(issueColumns));
 const issueCells=await page.locator(".fm-picking-issues tbody td").allTextContents();
 assert.ok(issueCells.includes("producto sin SKU/CN"),JSON.stringify(issueCells));
 assert.ok(issueCells.includes("texto, completo"),JSON.stringify(issueCells));
 assert.ok(issueCells.includes("cantidad no válida"),JSON.stringify(issueCells));
 await page.getByRole("button",{name:"Ocultar"}).click();
 await page.getByRole("button",{name:"Detalle"}).click();
 await page.getByText("#1001").waitFor();
 await page.getByText("#1002").waitFor();
 await page.getByRole("tab",{name:"Farmacia Abadía"}).click();
 await page.getByRole("heading",{name:"Preparación · Farmacia Abadía"}).waitFor();
 await page.getByText("3 uds. propuestas en Farmacia Abadía").waitFor();
 assert.equal(jsErrors.length,0,jsErrors.join("\n"));
 console.log("OK Picking List: indicadores por línea, columnas separadas y filas CSV originales visibles");
}finally{await browser.close();}
