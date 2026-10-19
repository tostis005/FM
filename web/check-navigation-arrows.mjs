// Las secciones con hijos deben mostrar una flecha visible y permitir
// desplegar/ocultar el submenú sin navegar. Se valida también la recarga.
import {chromium} from "playwright";
import assert from "node:assert/strict";
const BASE=process.env.RESPONSIVE_BASE_URL||"http://127.0.0.1:4175";
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1280,height:850}});
const user={email:"menu@example.invalid",name:"Test navegación",role:"superadministrador"};
const pharmacies=[{id:"1",name:"Farmacia de prueba",active:true,sourceCode:"ABA"}];
const modules=Object.fromEntries([
 "dashboard","ventas","compras","stock","proveedores","genericos",
 "rentabilidad","promociones","acciones","reposicion","informes"
].map(key=>[key,true]));
await page.route("**/api/**",async route=>{
 const path=new URL(route.request().url()).pathname;
 let body={};
 if(path==="/api/auth/me")body={user};
 else if(path==="/api/tenant/context")body={
  user,client:{slug:"ampedia",name:"Ampedia",schema:"ampedia"},
  clients:[{slug:"ampedia",name:"Ampedia"}],
  pharmacies,role:"superadministrador",modules
 };
 else if(path==="/api/tenant/promociones")body={promotions:[]};
 else if(path==="/api/tenant/farmacias")body=pharmacies;
 await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});
});
try{
 await page.goto(BASE+"/dashboard",{waitUntil:"domcontentloaded"});
 await page.locator("#farmetrica-sidebar .side-nav").waitFor({state:"visible",timeout:15000});
 for(const group of ["Ventas","Compras","Stock","Proveedores","Rentabilidad","Promociones","Oportunidades","Alertas"]){
  const caret=page.getByRole("button",{name:"Mostrar subopciones de "+group,exact:true});
  assert.equal(await caret.count(),1,group+" necesita flecha desplegable");
  assert.equal(await caret.getAttribute("aria-expanded"),"false");
 }
 // El chevrón debe ser reconocible incluso sin hover ni selección.
 const visual=await page.getByRole("button",{name:"Mostrar subopciones de Compras"}).evaluate(button=>{
  const buttonStyle=getComputedStyle(button),icon=button.querySelector("svg");
  const svgStyle=getComputedStyle(icon);
  return {background:buttonStyle.backgroundColor,color:buttonStyle.color,border:buttonStyle.borderTopWidth,
   width:icon.getBoundingClientRect().width,stroke:svgStyle.strokeWidth};
 });
 // El menú definitivo usa un chevrón blanco discreto SIN botón grande.
 assert.equal(visual.background,"rgba(0, 0, 0, 0)","La flecha debe ser discreta, sin fondo");
 assert.equal(visual.border,"0px","No debe dibujarse un recuadro");
 assert.ok(visual.width>=16&&visual.width<=20,"Flecha compacta");
 assert.ok(Number.parseFloat(visual.stroke)>=2,"El trazo debe seguir siendo legible");
 const rgb=(visual.color.match(/\d+/g)||[]).map(Number);
 assert.ok(rgb.length>=3&&rgb[0]>=200&&rgb[1]>=220&&rgb[2]>=200,
  "La flecha ha de ser blanca o verde muy claro sobre el lateral");
 const before=new URL(page.url()).pathname;
 await page.getByRole("button",{name:"Mostrar subopciones de Compras"}).click();
 assert.equal(new URL(page.url()).pathname,before,"desplegar no cambia de pantalla");
 await page.getByRole("button",{name:"Preparador de pedidos"}).waitFor({state:"visible"});
 await page.getByRole("button",{name:"Ocultar subopciones de Compras"}).click();
 await page.getByRole("button",{name:"Preparador de pedidos"}).waitFor({state:"hidden"});
 await page.getByRole("button",{name:"Mostrar subopciones de Compras"}).click();
 await page.getByRole("button",{name:"Preparador de pedidos"}).click();
 assert.equal(new URL(page.url()).pathname,"/compras-preparador");
 await page.reload({waitUntil:"domcontentloaded"});
 await page.getByRole("button",{name:"Ocultar subopciones de Compras"}).waitFor({timeout:15000});
 await page.getByRole("button",{name:"Preparador de pedidos"}).waitFor({state:"visible"});
 await page.goto(BASE+"/promociones",{waitUntil:"domcontentloaded"});
 await page.getByRole("button",{name:"Ocultar subopciones de Promociones"}).waitFor();
 await page.getByRole("navigation",{name:"Módulos"}).getByRole("button",{name:"Seguimiento",exact:true}).waitFor({state:"visible"});
 await page.setViewportSize({width:390,height:780});
 await page.getByRole("button",{name:"Abrir menú"}).click();
 await page.getByRole("button",{name:"Ocultar subopciones de Promociones"}).waitFor({state:"visible"});
 console.log("OK: flechas de todas las secciones con hijos, apertura/cierre, navegación, recarga y móvil");
}finally{await browser.close();}
