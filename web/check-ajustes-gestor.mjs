import {chromium} from "playwright";
import assert from "node:assert/strict";

const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1280,height:850}});
const user={email:"gestor-ajustes-ci@example.invalid",name:"Gestor prueba",role:"usuario"};
const pharmacies=[{id:"1",name:"Farmacia prueba",sourceCode:"ABA"}];
const context={user,role:"gestor",
 client:{slug:"ampedia",name:"Ampedia",schema:"ampedia",analysisMonths:12},
 clients:[{slug:"ampedia",name:"Ampedia"}],pharmacies,
 modules:{promociones:true},
 sections:{promociones:true,"seguimiento-global":true},
 profile:{id:2,name:"Gestor",permissions:{promociones:["ver","editar","importar"]}}};
const writes=[],errors=[],automatic=["ZZZ","*BAJA","* BAJA"];
page.on("pageerror",e=>errors.push(e.message));
await page.route("**/api/**",async route=>{
 const req=route.request(),path=new URL(req.url()).pathname,method=req.method();
 let body={};
 if(path==="/api/auth/me")body={user};
 else if(path==="/api/tenant/context")body=context;
 else if(path==="/api/tenant/farmacias")body=pharmacies;
 else if(path==="/api/tenant/pedidos/exclusiones"&&method==="GET")
  body={rules:[],automatic};
 else if(path==="/api/tenant/stock-objetivo"&&method==="GET")
  body={days:20,defaultDays:20};
 else if(path==="/api/analytics/politica-precios"&&method==="GET")
  body={global:{percentile:20,months:6},overrides:[]};
 else if(["PUT","POST","DELETE"].includes(method)){
  const data=req.postDataJSON?.()||{};
  writes.push({path,method,data});
  if(path==="/api/tenant/pedidos/exclusiones")
   body={id:"99",text:data.text.toUpperCase()};
  else if(path==="/api/tenant/stock-objetivo")body={days:data.days};
  else if(path==="/api/analytics/politica-precios")
   body={global:{percentile:data.percentile,months:data.months},overrides:[]};
  else body={};
 }
 await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});
});
try{
 await page.goto("http://127.0.0.1:4175/ajustes",{waitUntil:"domcontentloaded"});
 await page.getByRole("heading",{name:"Ajustes",exact:true}).waitFor({timeout:15000});
 await page.getByRole("button",{name:"Ajustes",exact:true}).first().waitFor();
 await page.getByRole("heading",{name:"Artículos excluidos de nuevos pedidos"}).waitFor();
 assert.equal(await page.getByRole("heading",{name:"Frecuencia de pedidos"}).count(),0);
 assert.equal(await page.getByText("Revisar",{exact:true}).count(),0);
 assert.equal(await page.getByText("Ejemplos detectados en nombres de Farmatic"}).count(),0);
 assert.equal(await page.getByText(/«Sonda vesical baja fricción»/).count(),1);
 await page.getByLabel("Nueva frase o cadena literal para excluir").fill("*BAJA*");
 await page.getByRole("button",{name:"Añadir regla"}).click();
 await page.getByText("Regla guardada.",{exact:false}).first().waitFor();
 assert.ok(writes.some(w=>w.path==="/api/tenant/pedidos/exclusiones"&&
  w.method==="POST"&&w.data.text==="*BAJA*"));
 await page.getByRole("button",{name:"Guardar período de análisis"}).click();
 assert.ok(writes.some(w=>w.path==="/api/tenant/configuracion-ventas"&&w.data.analysisMonths===12));
 await page.getByRole("button",{name:"Guardar cobertura global"}).click();
 assert.ok(writes.some(w=>w.path==="/api/tenant/stock-objetivo"&&w.data.days===20));
 await page.getByRole("button",{name:"Guardar política"}).click();
 assert.ok(writes.some(w=>w.path==="/api/analytics/politica-precios"&&w.data.percentile===20));
 assert.equal(errors.length,0,errors.join("\n"));
 console.log("OK gestor: Ajustes visibles, frecuencia retirada, reglas literales y configuraciones editables");
}finally{await browser.close()}
