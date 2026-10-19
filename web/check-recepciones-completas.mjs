// Recepciones completas: sólo documentos sincronizados; navegación y detalles reales.
import {chromium} from "playwright";
import assert from "node:assert/strict";
const BASE=process.env.RESPONSIVE_BASE_URL||"http://127.0.0.1:4175";
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1260,height:840}});
const user={email:"admin@example.invalid",name:"Administrador",role:"superadministrador"};
const pharmacies=[{id:"1",name:"Farmacia Centro",active:true,sourceCode:"ABA"}];
const modules=Object.fromEntries(["dashboard","compras","ventas","stock","rentabilidad","proveedores"].map(x=>[x,true]));
const seen=[],ctx={user,role:"superadministrador",clients:[{slug:"ampedia",name:"Cliente"}],
 client:{slug:"ampedia",name:"Cliente",schema:"ampedia"},modules,pharmacies};
await page.route("**/api/**",async route=>{
 const r=route.request(),url=new URL(r.url()),path=url.pathname;
 let body={};
 if(path==="/api/auth/me")body={user};
 else if(path==="/api/tenant/context")body=ctx;
 else if(path==="/api/tenant/farmacias")body=pharmacies;
 else if(path==="/api/tenant/promociones")body={promotions:[]};
 else if(path==="/api/analytics/pantallas/compras-recepciones"){
  seen.push(url.searchParams.toString());
  body={section:"compras-recepciones",available:true,total:1,
   page:1,pageSize:25,summary:{value:21,units:5,other:2},
   rows:[{pharmacyId:"1",pharmacyName:"Farmacia Centro",sourceSystem:"farmatic",
    documentId:"REC-CI-1",reference:"ALB-CI-1",supplierCode:"PR1",
    supplierName:"Proveedor Norte",orderNumber:"P-19",
    at:"2026-10-18T11:00:00.000Z",lines:2,units:5,amount:21}]};
 }
 else if(path==="/api/analytics/pantallas/compras-recepciones/lineas")
  body={farmacia:1,sistema:"farmatic",documento:"REC-CI-1",truncated:false,lines:[
   {lineId:"1",articleId:"CN01",units:2,unitPrice:4,netUnitCost:3,amount:6},
   {lineId:"2",articleId:"CN02",units:3,unitPrice:6,netUnitCost:5,amount:15}
  ]};
 await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});
});
try{
 await page.goto(BASE+"/compras-recepciones",{waitUntil:"domcontentloaded"});
 await page.getByRole("heading",{name:"Recepciones completas",exact:true}).waitFor({timeout:15000});
 await page.getByText("ALB-CI-1",{exact:true}).waitFor({timeout:12000});
 assert.equal(await page.getByText("Demo",{exact:true}).count(),0);
 assert.ok(await page.getByText("21,00 €").count()>=1 || await page.getByText(/21,00\s*€/).count()>=1);
 await page.getByRole("button",{name:"Ver líneas"}).click();
 await page.getByRole("heading",{name:/Recepción ALB-CI-1/}).waitFor();
 await page.getByText("CN01",{exact:true}).waitFor();
 await page.getByText("CN02",{exact:true}).waitFor();
 await page.getByRole("button",{name:"Cerrar detalle"}).click();
 await page.getByRole("button",{name:/Importe neto/}).first().click();
 await page.waitForTimeout(500);
 assert.ok(seen.some(x=>new URLSearchParams(x).get("orden")==="amount"),"La cabecera debe ordenar en servidor");
 await page.getByPlaceholder("Código, referencia, nombre…").fill("PR1");
 await page.waitForTimeout(800);
 assert.ok(seen.some(x=>new URLSearchParams(x).get("buscar")==="PR1"),
  "La búsqueda debe aplicarse al total de documentos, no solo a la página");
 await page.setViewportSize({width:390,height:800});
 await page.getByRole("heading",{name:"Recepciones completas",exact:true}).waitFor();
 console.log("OK: pantalla final de recepciones, líneas, búsqueda, ordenación y móvil");
}finally{await browser.close()}
