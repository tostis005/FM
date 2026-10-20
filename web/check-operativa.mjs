// Smoke de operativa real sin datos ficticios en el frontend FM, sin tocar PostgreSQL.
import {chromium} from "playwright";
import assert from "node:assert/strict";
const BASE=process.env.RESPONSIVE_BASE_URL||"http://127.0.0.1:4175";
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1250,height:850}});
const posted=[];
const client="ampedia";
const pharmacies=[{id:"1",name:"Farmacia Centro",active:true},{id:"2",name:"Farmacia Norte",active:true}];
const modules=Object.fromEntries(["dashboard","compras","acciones","stock","rentabilidad","ventas","promociones","reposicion"].map(s=>[s,true]));
const user={email:"admin@example.invalid",name:"Administrador",role:"superadministrador"};
const ctx={user,role:"superadministrador",clients:[{slug:client,name:"Cliente"}],
 client:{slug:client,name:"Cliente",schema:client},modules,pharmacies};
await page.route("**/api/**",async route=>{
 const request=route.request(),url=new URL(request.url()),p=url.pathname;
 let payload={},status=200;
 if(p==="/api/auth/me")payload={user};
 else if(p==="/api/tenant/context")payload=ctx;
 else if(p==="/api/tenant/promociones")payload={promotions:[]};
 else if(p==="/api/tenant/farmacias")payload=pharmacies;
 else if(p==="/api/operativa/responsables")payload={items:[{email:user.email,role:"administrador"}]};
 else if(p==="/api/operativa"){
  if(request.method()==="POST"){
   const body=JSON.parse(request.postData()||"{}");posted.push(body);
   payload={item:{id:"550e8400-e29b-41d4-a716-446655440000",revision:1,...body}};
   status=201;
  }else{
   const recurso=url.searchParams.get("recurso");
   payload={items:[],scope:{canEdit:true,canApprove:true,cliente:client,farmacia:1}};
   if(recurso==="resultados")payload.items=[];
  }
 }
 await route.fulfill({status,contentType:"application/json",body:JSON.stringify(payload)});
});
try{
 await page.goto(BASE+"/compras-preparador",{waitUntil:"domcontentloaded"});
 await page.getByRole("heading",{name:"Preparador de pedidos",exact:true}).waitFor({timeout:15000});
 await page.getByRole("button",{name:/Nuevo borrador/}).click();
 await page.getByLabel("Código de artículo").fill("CN0001");
 await page.getByLabel("Descripción",{exact:true}).last().fill("Producto de prueba");
 await page.getByLabel("Necesidad (uds.)").fill("20");
 await page.getByRole("button",{name:"Añadir artículo"}).click();
 await page.getByRole("button",{name:"Guardar borrador"}).click();
 await page.waitForFunction(()=>document.querySelector(".fm-op-message")?.textContent.includes("guardados"),null,{timeout:10000});
 assert.ok(posted.some(x=>x.recurso==="pedidos"&&x.lineas?.[0]?.necesidad===20));
 assert.equal(await page.getByRole("button",{name:"Ver ejemplo de demo"}).count(),0);
 assert.equal(await page.getByText("Pantalla de demostración").count(),0,
  "La pantalla de pedidos no debe ofrecer cifras simuladas");
 await page.getByRole("heading",{name:"Preparador de pedidos",exact:true}).waitFor();
 // Una pantalla operativa individual no debe pisar el filtro general de varias farmacias.
 await page.evaluate(()=>sessionStorage.setItem("fm_shared_report_filters_v1:ampedia",
  JSON.stringify({period:"this_month",pharmacyIds:["1","2"]})));
 await page.getByRole("combobox",{name:"Farmacia",exact:true}).selectOption("2");
 const shared=await page.evaluate(()=>JSON.parse(
  sessionStorage.getItem("fm_shared_report_filters_v1:ampedia")));
 assert.deepEqual(shared.pharmacyIds,["1","2"],
  "Operativa no puede convertir una selección de varias farmacias en una sola");
 for(const [path,title] of [
  ["oportunidades-seguimiento","Seguimiento de oportunidades"],
  ["alertas","Alertas"],["mi-trabajo","Mi trabajo"],
  ["stock-traspasos","Traspasos entre farmacias"],["rentabilidad-retorno","Retorno económico"]
 ]){
  await page.goto(BASE+"/"+path,{waitUntil:"domcontentloaded"});
  await page.getByRole("heading",{name:title,exact:true,level:1}).waitFor({timeout:13000});
  assert.equal(await page.getByRole("combobox",{name:"Farmacia",exact:true}).inputValue(),"2",
   "La última farmacia operativa debe mantenerse entre pantallas");
  const error=await page.locator(".fm-op-error").count();
  if(error)throw Error(path+" presenta error inesperado");
 }
 console.log("OK: pantallas operativas, creación de borrador, sin datos de muestra y navegabilidad");
}finally{await browser.close();}
