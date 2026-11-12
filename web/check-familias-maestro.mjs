import {chromium} from "playwright";
import assert from "node:assert/strict";

const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1240,height:820}});
const user={email:"familias-ci@example.invalid",name:"Pruebas familias",role:"superadministrador"};
const pharmacies=[{id:"1",name:"Farmacia Abadía",sourceCode:"ABA"},
 {id:"2",name:"Farmacia Europa",sourceCode:"EUR"}];
const context={user,role:"superadministrador",client:{slug:"ampedia",name:"Ampedia",schema:"ampedia"},
 clients:[{slug:"ampedia",name:"Ampedia"}],pharmacies,modules:{stock:true}};
const calls=[],errors=[];
page.on("pageerror",err=>errors.push(err.message));
const references=[
 {id:"1",name:"Dermocosmética",segment:"PARAFARMACIA",referencePharmacy:"ALMACEN",referenceCode:"21"},
 {id:"2",name:"Analgésicos",segment:"MEDICACION",referencePharmacy:"ABA",referenceCode:"4"},
 {id:"4",name:"DERMOCOSMETICA",segment:"MEDICACION",referencePharmacy:"ABA",referenceCode:"40"}
];
const masterGroups=[
 {id:"2",key:"analgesicos",name:"Analgésicos",segments:["MEDICACION"],
  members:[references[1]],referencePharmacy:"ABA"},
 {id:"1",key:"dermocosmetica",name:"Dermocosmética",
  segments:["MEDICACION","PARAFARMACIA"],
  members:[references[2],references[0]],referencePharmacy:"ALMACEN"}
];
const pending={id:"3",name:"Pendiente local",segment:"SIN_DETERMINAR"};
const pendingGroups=[{id:"3",key:"pendiente local",name:"Pendiente local",
 segments:["SIN_DETERMINAR"],members:[pending]}];
await page.route("**/api/**",async route=>{
 const request=route.request(),url=new URL(request.url()),path=url.pathname;
 calls.push(path+url.search);
 let response={};
 if(path==="/api/auth/me")response={user};
 else if(path==="/api/tenant/context")response=context;
 else if(path==="/api/tenant/farmacias")response=pharmacies;
 else if(path==="/api/tenant/familias-globales")
  response={items:url.searchParams.get("view")==="pendientes"?[pending]:references,
   groups:url.searchParams.get("view")==="pendientes"?pendingGroups:masterGroups,
   total:url.searchParams.get("view")==="pendientes"?1:2,
   summary:{maestros:2,medicacion:2,parafarmacia:1,pendientes:1}};
 else if(path==="/api/tenant/familias-globales/1/origenes")
  response={items:[
   {pharmacyCode:"ALMACEN",sourceCode:"21",sourceName:"Dermocosmética"},
   {pharmacyCode:"EUR",sourceCode:"2022",sourceName:"2022 - Dermocosmética"}
  ]};
 await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(response)});
});
try{
 await page.goto("http://127.0.0.1:4175/familias-maestro",{waitUntil:"domcontentloaded"});
 await page.getByRole("heading",{name:"Maestro de familias"}).waitFor({timeout:15000});
 await page.getByText("Dermocosmética",{exact:true}).waitFor({timeout:15000});
 assert.equal(await page.locator(".fm-family-row").count(),2,"solo se muestran familias consolidadas");
 assert.deepEqual((await page.locator(".fm-family-title > strong").allTextContents())
  .map(x=>x.trim()),["Analgésicos","Dermocosmética"],
  "Una fila por nombre, orden alfabético español, sin separar primero por segmento");
 assert.equal(await page.getByText("2 clasificaciones agrupadas").count(),1);
 assert.equal(calls.filter(x=>x.includes("/api/tenant/familias-globales/1/origenes")).length,0,
  "no deben cargarse los orígenes al entrar");
 assert.equal(calls.filter(x=>x.includes("/articulos")).length,0,
  "no se deben cargar CN individuales");
 assert.equal(await page.getByText("2022 - Dermocosmética").count(),0);
 await page.getByRole("button",{name:"Ver nombres locales de Dermocosmética"}).click();
 await page.getByText("2022 - Dermocosmética").waitFor();
 assert.equal(calls.filter(x=>x.includes("/1/origenes")).length,1);
 await page.getByRole("tab",{name:/Por revisar/}).click();
 await page.getByText("Pendiente local").waitFor();
 assert.equal(await page.locator(".fm-family-row").count(),1);
 assert.ok(calls.some(x=>x.includes("view=pendientes")));
 assert.equal(errors.length,0,errors.join("\n"));
 console.log("OK maestro familias: lista alfabética, variantes agrupadas y orígenes bajo demanda");
}finally{await browser.close()}
