// Regresión: la recarga/F5 mantiene la ruta SPA mientras la sesión se resuelve.
// Simula el caso donde el superadministrador aún no tiene su user cargado
// cuando el contexto llega desde la API, y los módulos del cliente son limitados.
import {chromium} from "playwright";
import assert from "node:assert/strict";

const BASE=process.env.RESPONSIVE_BASE_URL||"http://127.0.0.1:4175";
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const context=await browser.newContext({viewport:{width:1280,height:850}});
const page=await context.newPage();
let role="superadministrador";
const pharmacies=[{id:"1",name:"Farmacia de prueba",active:true,sourceCode:"ABA"}];
const modules={promociones:true,dashboard:false,ventas:false,stock:false,compras:false};
await page.route("**/api/**",async route=>{
 const url=new URL(route.request().url()),path=url.pathname;
 const user={email:"qa@example.com",name:"Test",role};
 let result={};
 if(path==="/api/auth/me")result={user};
 else if(path==="/api/tenant/context")
  result={user,client:{slug:"ampedia",name:"Ampedia",schema:"ampedia"},
    clients:[{slug:"ampedia",name:"Ampedia"}],pharmacies,role,modules};
 else if(path==="/api/tenant/promociones"){
  // Mantener sin resolver la recuperación de campañas para destapar el fallo
  // anterior: tenantContext se ponía antes que sessionUser.
  await new Promise(resolve=>setTimeout(resolve,650));
  result={promotions:[]};
 }else if(path==="/api/analytics/ventas")result={
  monthly:[],series:[],granularity:"month",products:[],totalProducts:0,totalArticles:0};
 else if(path==="/api/tenant/farmacias")result=pharmacies;
 await route.fulfill({status:200,contentType:"application/json",
  headers:{"cache-control":"no-store"},body:JSON.stringify(result)});
});
async function assertRoute(route,title){
 await page.goto(BASE+route,{waitUntil:"domcontentloaded"});
 await page.waitForTimeout(200);
 assert.equal(new URL(page.url()).pathname,route,"La ruta no puede cambiar mientras se carga el usuario");
 try{
  await page.getByRole("heading",{name:title,exact:true}).first().waitFor({state:"visible",timeout:10000});
 }catch(e){
  const state=await page.evaluate(()=>({
    pathname:location.pathname,headings:[...document.querySelectorAll("h1,h2")].map(x=>x.textContent),
    text:document.querySelector("main")?.innerText?.slice(0,380),
    nav:document.querySelector("nav")?.innerText?.slice(0,240)
  })).catch(()=>({}));
  console.error("Estado de ruta F5:",JSON.stringify(state));
  throw e;
 }
 assert.equal(new URL(page.url()).pathname,route,"La ruta debe mantenerse tras autenticar");
 await page.reload({waitUntil:"domcontentloaded"});
 await page.getByRole("heading",{name:title,exact:true}).first().waitFor({state:"visible",timeout:10000});
 assert.equal(new URL(page.url()).pathname,route,"F5 debe mantener "+route);
}
try{
 await assertRoute("/ventas","Ventas");
 await assertRoute("/dashboard","Dashboard");
 await assertRoute("/compras","Compras");
 // Las rutas internas deben seguir funcionando al usar los botones de la SPA.
 await page.getByRole("button",{name:"Ventas",exact:true}).first().click();
 assert.equal(new URL(page.url()).pathname,"/ventas");
 await page.goBack({waitUntil:"domcontentloaded"});
 assert.equal(new URL(page.url()).pathname,"/compras","Atrás debe volver al módulo anterior");
 await page.goForward({waitUntil:"domcontentloaded"});
 assert.equal(new URL(page.url()).pathname,"/ventas","Adelante debe respetar la navegación");
 // A diferencia del caso temporal, un módulo REALMENTE no autorizado sí redirige.
 role="farmacia";
 await page.goto(BASE+"/ventas",{waitUntil:"domcontentloaded"});
 await page.waitForURL("**/promociones",{timeout:12000});
 assert.equal(new URL(page.url()).pathname,"/promociones");
 console.log("OK: F5 y navegación atrás/adelante conservan la ruta; permisos se validan al terminar login");
}finally{await context.close();await browser.close();}
