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
 else if(path==="/api/analytics/pedidos/propuesta"){
  const id=url.searchParams.get("buscar")||"";
  const g={key:"CN:123456",cn:"123456",articleName:"Crema de manos",
   stock:10,unitsPeriod:24,units3:90,units12:300,suggested:8,
   pharmacies:[
    {pharmacyId:"1",articleId:"771",articleName:"Crema de manos",cn:"123456",
     unitsPeriod:12,units3:45,units12:150,stock:6,suggested:3,ordered:0,
     daily:0.5,interval:7,lead:2,safety:0,policyDefault:false,confidence:"calculable"},
    {pharmacyId:"2",articleId:"999",articleName:"Crema de manos",cn:"123456",
     unitsPeriod:12,units3:45,units12:150,stock:4,suggested:5,ordered:0,
     daily:0.5,interval:7,lead:2,safety:0,policyDefault:false,confidence:"calculable"}]};
  body={available:true,groups:id&&id!=="123456"?[]:[g],truncated:false,pharmacies};
 }
 await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});
});
try{
 await page.goto(BASE+"/compras-preparador",{waitUntil:"domcontentloaded"});
 await page.getByRole("heading",{name:"Propuesta inteligente de compra"}).waitFor({timeout:15000});
 await page.getByText("Crema de manos").first().waitFor({timeout:15000});
 await page.getByRole("button",{name:/Crema de manos/}).first().click();
 await page.getByText("ERP 771").waitFor();
 await page.getByText("ERP 999").waitFor();
 assert.equal(await page.locator(".fm-planner-pharmacy").count(),2);
 const controls=page.locator(".fm-planner-pharmacy");
 await controls.nth(0).locator('input[list]').fill("P44");
 await controls.nth(1).locator('input[list]').fill("P44");
 await page.getByRole("button",{name:"Guardar borradores por proveedor"}).click();
 await page.waitForFunction(()=>document.body.textContent.includes("borradores guardados"),null,{timeout:15000});
 assert.equal(posts.length,2,"Una farmacia genera su borrador separado del resto");
 assert.deepEqual(posts.map(p=>p.farmacia).sort(),["1","2"]);
 assert.deepEqual(posts.map(p=>p.lineas[0].articulo).sort(),["771","999"]);
 assert.ok(posts.every(p=>p.lineas[0].asignaciones[0].proveedor==="P44"));
 assert.deepEqual(errors,[]);
 console.log("OK: Preparador consolidado, desglose por farmacia, proveedor y borradores guardados");
}finally{await browser.close()}
