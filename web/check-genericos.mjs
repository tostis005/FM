import {chromium} from "playwright";
import assert from "node:assert/strict";
const BASE=process.env.RESPONSIVE_BASE_URL||"http://127.0.0.1:4175";
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const page=await browser.newPage({viewport:{width:1280,height:850}});
const user={email:"qa@example.com",role:"superadministrador",name:"QA"};
const modules={promociones:true,ventas:true,dashboard:true,genericos:true};
const pharmacies=[{id:"1",name:"Farmacia Centro",sourceCode:"ABA",active:true},{id:"2",name:"Farmacia Norte",sourceCode:"NOR",active:true}];
const context={user,client:{slug:"ampedia",name:"Ampedia",schema:"ampedia"},
 clients:[{slug:"ampedia",name:"Ampedia"}],pharmacies,modules,role:"superadministrador"};
let headerSeen=false;
let listRequests=0,detailRequests=0,catalogRequests=0,movementsRequests=0;
await page.route("**/api/**",async route=>{
 const req=route.request(),u=new URL(req.url()),p=u.pathname;
 let data={};
 if(p==="/api/auth/me")data={user};
 else if(p==="/api/tenant/context")data=context;
 else if(p==="/api/tenant/promociones")data={promotions:[]};
 else if(p==="/api/tenant/farmacias")data=pharmacies;
 else if(p==="/api/genericos/reales"&&u.searchParams.get("buscar")==="error-api"){
  await route.fulfill({status:503,contentType:"application/json",
   body:JSON.stringify({error:"Error de consulta simulado"})});return;
 }
 else if(p==="/api/genericos/reales"){
  listRequests++;
  await new Promise(resolve=>setTimeout(resolve,650));
  data={version:{sha256:"aa",fecha_fuente:"2026-10-18",importado_en:"2026-10-18",total_genericos:6000},
    totalGroups:2,summary:{salesUnits:22,revenue:240,purchases:118,savings:19.68},policy:{global:{percentile:20,months:6},overrides:[]},
    groups:[{dcpf:"123456789",principle:"Omeprazol",name:"Omeprazol A 20 mg 28 cápsulas",
      officialDescription:"Omeprazol 20 mg 28 cápsulas gastrorresistentes vía oral",
      skuCount:2,genericCount:2,salesUnits:22,revenue:240,
      purchaseUnits:12,spent:118,averagePuc:9.84,averagePvp:15,pvpMarginPct:34.4,bestPuc:8.2,indicativeSavings:19.68},
     {dcpf:"987654321",principle:"Omeprazol",name:"Omeprazol B 40 mg 14 cápsulas",
      officialDescription:"Omeprazol 40 mg 14 cápsulas gastrorresistentes vía oral",
      skuCount:1,genericCount:1,salesUnits:0,revenue:0,spent:0,averagePuc:null,averagePvp:null,
      bestPuc:null,indicativeSavings:null}],
    sales:{available:true},purchases:{available:true}};
 }
 else if(p==="/api/genericos/reales/123456789"){
  detailRequests++;
  assert.equal(u.searchParams.get("vista"),"articulos");
  headerSeen=req.headers()["x-farmetrica-cliente"]==="ampedia";
  const products=[
   {cn:"654321",nombre:"Omeprazol A 20 mg",laboratorio:"Lab A",
    soldUnits:27,soldAmount:295,buyUnits:14,buyAmount:144,puc:144/14},
   {cn:"654322",nombre:"Omeprazol B 20 mg",laboratorio:"Lab B",
    soldUnits:0,soldAmount:0,buyUnits:0,buyAmount:0,puc:null}
  ];
  if(u.searchParams.get("soloCatalogo")==="1"){
   catalogRequests++;
   data={view:"articles",products:products.map(p=>({...p,
    soldUnits:0,soldAmount:0,buyUnits:0,buyAmount:null,puc:null})),
    salesAvailable:null,purchasesAvailable:null,movementsPending:true};
  }else{
   movementsRequests++;
   await new Promise(resolve=>setTimeout(resolve,700));
   if(movementsRequests===1){
    await route.fulfill({status:503,contentType:"application/json",
     body:JSON.stringify({error:"Consulta de movimientos agotada"})});return;
   }
   data={view:"articles",products,salesAvailable:true,purchasesAvailable:true};
  }
 }
 else if(p==="/api/ventas/seguimiento")data={sales:{}};
 await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(data)});
});
try{
 await page.goto(BASE+"/genericos",{waitUntil:"domcontentloaded"});
 await page.getByRole("heading",{name:"Genéricos",exact:true}).waitFor();
 await page.waitForFunction(()=>document.querySelectorAll(".fm-generic-metric .fm-kpi-spinner").length===5,
  {timeout:7000});
 assert.equal(await page.locator(".fm-generic-chart .fm-loading-panel").count(),1);
 const alignment=await page.locator(".fm-generic-metric .fm-kpi-spinner").evaluateAll(items=>
  items.map(item=>{
   const spin=item.querySelector(".fm-load-spinner")?.getBoundingClientRect();
   const label=item.querySelector(".fm-kpi-loading-label")?.getBoundingClientRect();
   return spin&&label?Math.abs((spin.top+spin.height/2)-(label.top+label.height/2)):99;
  }));
 assert.ok(alignment.length===5&&alignment.every(delta=>delta<=2.5),
   "Spinner y texto deben estar centrados en todos los KPI: "+alignment);
 assert.equal(await page.locator(".fm-generic-list .fm-loading-panel").count(),1);
 // La molécula no puede sustituir al descriptor clínico con dosis y envase.
 await page.getByText("Omeprazol 20 mg 28 cápsulas gastrorresistentes vía oral",{exact:true}).first().waitFor({timeout:10000});
 await page.getByText("Omeprazol 40 mg 14 cápsulas gastrorresistentes vía oral",{exact:true}).first().waitFor({timeout:10000});
 assert.equal(await page.locator(".fm-generic-click-row").count(),2,
   "Distinta dosis y tamaño de envase deben aparecer como conjuntos distintos");
 assert.equal(await page.locator(".fm-generic-chart .recharts-bar-rectangle").count()>0,true);
 assert.equal(await page.getByText("revenue",{exact:true}).count(),0,
   "El gráfico debe emplear denominaciones en castellano");
 await page.getByRole("button",{name:"Desplegar conjunto 123456789"}).click();
 await page.getByText("Omeprazol A 20 mg",{exact:true}).waitFor();
 assert.equal(headerSeen,true,"La petición de detalle mantiene tenant explícito");
 assert.equal(catalogRequests,1,"El catálogo debe tener una sola lectura rápida");
 assert.ok(await page.locator(".fm-generic-detail table tbody tr").count()===2,
  "El catálogo aparece antes de los cálculos de ventas");
 assert.equal(await page.locator(".fm-generic-detail .fm-dual-scroll").count(),0,
  "El detalle no debe introducir otro scroll anidado");
 assert.equal(await page.locator(".fm-generic-detail .fm-table-toolbar").count(),0,
  "El detalle no debe tener filtros ni paginadores redundantes");
 assert.equal(await page.locator(".fm-generic-detail table").count(),1);
 assert.equal(await page.locator(".fm-generic-detail table tbody tr").count(),2);
 assert.equal(await page.getByText("Equivalente de referencia",{exact:true}).count(),0);
 assert.equal(await page.getByText("PUC óptimo",{exact:true}).count(),0);
 const firstRow=page.locator(".fm-generic-detail table tbody tr").first();
 assert.match(await firstRow.innerText(),/654321/);
 await page.getByText("Los artículos siguen disponibles.",{exact:false}).first().waitFor({timeout:9000});
 assert.equal(await page.locator(".fm-generic-detail table tbody tr").count(),2,
  "Un fallo de movimientos nunca debe eliminar los CN ya cargados");
 await page.getByRole("button",{name:"Reintentar movimientos"}).click();
 await page.waitForFunction(()=>document.querySelector(".fm-generic-detail table tbody tr")?.
   textContent.includes("27"),{timeout:9000});
 assert.match(await firstRow.innerText(),/27/,"Las ventas se recuperan al reintentar");
 const scrolls=await page.evaluate(()=>{
  const detail=document.querySelector(".fm-generic-detail");
  const parent=document.querySelector(".fm-generic-list .fm-generic-table-scroll");
  return {parent:!!parent,inner:[...detail.querySelectorAll("*")].filter(el=>
   /(auto|scroll)/.test(getComputedStyle(el).overflowX)&&el.scrollWidth>el.clientWidth+2).length};
 });
 assert.equal(scrolls.parent,true);
 assert.equal(scrolls.inner,0,"No hay scroll horizontal propio dentro del detalle");
 await page.getByRole("button",{name:"Desplegar conjunto 123456789"}).click();
 await page.getByRole("button",{name:"Desplegar conjunto 123456789"}).click();
 await page.getByText("Omeprazol A 20 mg",{exact:true}).waitFor();
 assert.equal(catalogRequests,1,"Reabrir reutiliza el catálogo");
 assert.equal(movementsRequests,2,"Reabrir no reconsulta los movimientos una vez completos");
 await page.setViewportSize({width:390,height:844});
 const mobile=await page.evaluate(()=>{
  const outer=document.querySelector(".fm-generic-list .fm-generic-table-scroll");
  const inner=document.querySelector(".fm-generic-detail");
  const top=document.querySelector(".fm-generic-list .fm-dual-scroll-top");
  return {outerScroll:outer?.scrollWidth>outer?.clientWidth,
   nestedScroll:[...inner.querySelectorAll("*")].some(el=>
    /auto|scroll/.test(getComputedStyle(el).overflowX)&&el.scrollWidth>el.clientWidth+2),
   extraTopVisible:top&&getComputedStyle(top).display!=="none"};
 });
 assert.equal(mobile.outerScroll,true,"En móvil se conserva el scroll de la tabla padre");
 assert.equal(mobile.nestedScroll,false,"En móvil no aparecen scrolls internos");
 assert.equal(mobile.extraTopVisible,false,"No duplicar las barras de desplazamiento");
 await page.setViewportSize({width:1280,height:850});
 // Recuperar foco no debe desmontar los conjuntos ni rehacer la petición.
 const initialRequests=listRequests;
 await page.evaluate(()=>{
  document.dispatchEvent(new Event("visibilitychange"));
  window.dispatchEvent(new Event("focus"));
 });
 await page.waitForTimeout(500);
 assert.equal(listRequests,initialRequests,"Genéricos se ha recargado por recuperar foco");
 await page.getByRole("button",{name:"Actualizar",exact:true}).click();
 await page.waitForFunction(()=>document.querySelector(".fm-generic-chart")!==null);
 await page.waitForTimeout(750);
 assert.ok(listRequests>initialRequests,"Actualizar explícitamente debe consultar genéricos");
 await page.getByPlaceholder("Buscar conjunto…").fill("error-api");
 await page.locator(".fm-generic-list .fm-generic-empty-text").waitFor({timeout:8000});
 await page.getByRole("alert").filter({hasText:"Error de consulta simulado"}).first().waitFor({timeout:7000});
 assert.equal(await page.locator(".fm-generic-click-row").count(),0,
  "Tras un fallo de consulta no se deben mostrar los resultados del filtro anterior");
 console.log("OK: Genéricos carga por visual, muestra agrupación DCPF y desglose aislado por cliente");
}finally{await browser.close();}
