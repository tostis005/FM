import {chromium} from "playwright";
import assert from "node:assert/strict";
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1280,height:850}});
const user={email:"lab-qa@example.invalid",role:"superadministrador",name:"QA"};
const pharmacies=[{id:"1",name:"Centro",sourceCode:"ABA",databaseCode:"ABA",active:true},{id:"2",name:"Norte",sourceCode:"NOR",databaseCode:"NOR",active:true}];
const warehouses=[{id:"6",name:"Almacén central",laboratoryReportName:"WAO",establishmentType:"almacen",sourceCode:"ALMACEN",active:true}];
const context={user,clients:[{slug:"ampedia",name:"Ampedia"}],client:{slug:"ampedia",name:"Ampedia",schema:"ampedia"},role:"superadministrador",pharmacies,warehouses,modules:{ventas:true,genericos:true,compras:true}};
let releasePurchases;const purchasesReady=new Promise(resolve=>releasePurchases=resolve);
const requests=[];
const common={salesAvailable:false,purchasesAvailable:false,tariffsAvailable:false,purchaseAccess:true,tariffAccess:true,products:[],warnings:[],summary:{},destinations:[]};
await page.route("**/api/**",async route=>{
 const u=new URL(route.request().url()),part=u.searchParams.get("parte");let body={};
 if(u.pathname==="/api/auth/me")body={user};
 else if(u.pathname==="/api/tenant/context")body=context;
 else if(u.pathname==="/api/tenant/farmacias")body=pharmacies;
 else if(u.pathname==="/api/analytics/ventas/laboratorios")body={items:[{key:"P:10",name:"Laboratorio prueba"}]};
 else if(u.pathname==="/api/analytics/ventas/laboratorios/analisis"){
  requests.push(part);
  if(part==="ventas")body={...common,salesAvailable:true,summary:{salesUnits:9,revenue:90,genericSoldProducts:0},families:[{key:"2",name:"Medicamentos"}],siteSales:[{id:"1",units:3,amount:30},{id:"2",units:2,amount:20},{id:"6",units:4,amount:40}]};
  else if(part==="directas")body={...common,directAvailable:true,directStatus:"available",summary:{directAmount:12,directUnits:3},siteDirect:[{id:"6",amount:12,units:3}]};
  else if(part==="compras"){await purchasesReady;body={...common,purchasesAvailable:true,summary:{purchaseAmount:70,purchaseUnits:10},sitePurchases:[{id:"1",amount:20,units:2},{id:"2",amount:10,units:2},{id:"6",amount:40,units:6}]};}
  else if(part==="ahorro")body={...common,salesAvailable:true,tariffsAvailable:true};
 }
 await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});
});
try{
 await page.goto("http://127.0.0.1:4175/ventas-laboratorios",{waitUntil:"domcontentloaded"});
 const picker=page.getByLabel("Seleccionar laboratorio para analizar");
 await picker.click();
 await page.getByText("Laboratorio prueba",{exact:true}).first().click();
 const table=page.locator("section").filter({has:page.getByRole("heading",{name:"Ventas y compras por establecimiento"})}).locator("table.smart-table");
 await table.waitFor({timeout:15000});
 const wao=table.locator("tbody tr").filter({hasText:"WAO"});
 await wao.getByText(/12,00/).waitFor({timeout:10000});
 assert.ok((await wao.innerText()).includes("Calculando"),"Las directas deben estar disponibles mientras compras totales siguen pendientes");
 assert.ok(!requests.includes("familias")&&!requests.includes("compras-completas"));
 await table.getByRole("button",{name:"Ordenar Establecimiento"}).click();
 assert.ok((await table.locator("tbody tr").first().innerText()).includes("Centro"));
 await table.getByRole("button",{name:"Filtrar por Establecimiento"}).click();
 await page.getByRole("dialog",{name:"Seleccionar Establecimiento"}).getByText("WAO",{exact:true}).click();
 await page.getByRole("button",{name:"Listo",exact:true}).click();
 assert.equal(await table.locator("tbody tr").count(),1);
 releasePurchases();
 await wao.locator("td").nth(4).getByText(/40,00/).waitFor();
 assert.ok(!(await wao.innerText()).includes("Calculando"));
 console.log("OK: WAO con ordenación/filtro estándar y cargas independientes");
}finally{releasePurchases();await browser.close()}
