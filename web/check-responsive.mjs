// Pruebas visuales de desbordamiento horizontal en viewport reales.
// Ejecutar con: npm install --no-save playwright && npx playwright install chromium
//                npm run dev -- --port 4175   (en otra terminal)
//                node check-responsive.mjs
import {chromium} from "playwright";
import {mkdir} from "node:fs/promises";
const BASE=process.env.RESPONSIVE_BASE_URL||"http://127.0.0.1:4175";
const routes=[
 "promociones","promociones/seguimiento","promociones/simulador","dashboard","ventas","compras",
 "proveedores","stock","stock-sin-recepciones","reposicion","genericos","rentabilidad","acciones",
 "informes","asistente","farmacias","usuarios","clientes","accesos","ajustes"
];
const sizes=[
 {width:320,height:740},{width:375,height:812},{width:414,height:896},
 {width:560,height:850},{width:768,height:1024},{width:1024,height:768},
 {width:1440,height:900}
];
const pharmacies=[
 {id:"1",name:"Abadía",city:"",active:true,sourceCode:"ABA",sourceHost:"",sourceDatabase:"Farmatic"},
 {id:"2",name:"Europa",city:"",active:true,sourceCode:"EUR",sourceHost:"",sourceDatabase:"Farmatic"},
 {id:"3",name:"Buenavista",city:"",active:true,sourceCode:"BUE",sourceHost:"",sourceDatabase:"Farmatic"},
 {id:"4",name:"Estación",city:"",active:true,sourceCode:"EST",sourceHost:"",sourceDatabase:"Farmatic"},
 {id:"5",name:"Valdemarías",city:"",active:true,sourceCode:"POL",sourceHost:"",sourceDatabase:"Farmatic"}
];
const modules=Object.fromEntries(
 ["dashboard","promociones","ventas","compras","proveedores","stock","reposicion",
  "genericos","rentabilidad","acciones","informes","asistente"].map(m=>[m,true]));
const user={email:"jose.fraga@gmail.com",name:"Administrador de pruebas",role:"superadministrador"};
const context={user,clients:[{slug:"ampedia",name:"Ampedia"},{slug:"cliente_demo",name:"Cliente de pruebas"}],
 client:{slug:"ampedia",name:"Ampedia",schema:"ampedia"},role:"superadministrador",
 modules,pharmacies};
const client={slug:"ampedia",name:"Ampedia",schema:"ampedia",active:true,modules};
async function mockApi(route){
 const url=new URL(route.request().url());
 const path=url.pathname;
 let payload={};
 if(path==="/api/auth/me")payload={user};
 else if(path==="/api/tenant/context")payload={...context,
   client:url.searchParams.get("cliente")==="cliente_demo"
    ? {slug:"cliente_demo",name:"Cliente de pruebas",schema:"cliente_demo"}:context.client,
   modules:url.searchParams.get("cliente")==="cliente_demo"
    ? {...modules,asistente:false}:modules};
 else if(path==="/api/health/database")payload={database:"unavailable",status:"ok"};
 else if(path==="/api/tenant/farmacias"||path==="/api/farmacias")payload=pharmacies;
 else if(path==="/api/admin/clientes")payload=[client];
 else if(path==="/api/tenant/usuarios")payload=[{email:user.email,name:user.name,role:"administrador",pharmacies:[],active:true}];
 else if(path==="/api/admin/domains"||path==="/api/admin/accounts")payload=[];
 else if(path==="/api/auth/config")payload={googleClientId:"",emailCodesAvailable:false,configured:true};
 else if(path==="/api/analytics/ventas"){
  const filter=url.searchParams.get("farmacias");
  const count=filter?filter.split(",").length:pharmacies.length;
  payload={monthly:[{month:"2026-10",ventas:count*1000,unidades:count*75}],
    products:[],totalProducts:0,totalArticles:count*10};
 }
 else if(path==="/api/analytics/reportes"){
  const selected=url.searchParams.get("farmacias");
  const count=selected?selected.split(",").length:pharmacies.length;
  const money=count*1000;
  const product={id:"1|654321",pharmacyId:"1",cn:"654321",name:"Artículo real de prueba",
   pvp:8,purchaseCost:2,saleUnitPrice:7,unitMargin:5,units:3,value:21,margin:15};
  payload={available:true,monthly:[{month:"2026-10",ventas:money,compras:money/2,unidades:count*75}],
   kpis:{ventas:money,compras:money/2,unidades:count*75,proveedores:count,
    articulosVendidos:count,stock:null,margen:15},
   salesRows:[product],buyRows:[],supplierRows:[],stockRows:url.searchParams.get("modulo")==="stock"?[{
    ...product,units:12,sold:2,unitCost:2,coverage:14,value:24,excessValue:0
   }]:[],replenishmentRows:[],
   profitRows:[product],actions:[],families:[],
   availability:{sales:true,purchases:true,stock:false,stockAsOf:"2026-10-01T10:00:00.000Z",rowsTruncated:false}};
 }
 else if(path==="/api/analytics/stock/sin-recepciones")
  payload={available:true,total:1,page:1,rows:[{
   pharmacyId:"1",pharmacyName:"Abadía",cn:"030303",sourceId:"030303",
   name:"Artículo de stock con CN",supplierName:"Laboratorio",
   stock:12,pvp:4.5,lastReceiptAt:"2023-01-01",lastSaleAt:"2026-09-01"}]};
 else if(path==="/api/analytics/ventas/totales"){
  const selected=url.searchParams.get("farmacias");
  const count=selected?selected.split(",").length:pharmacies.length;
  payload={monthly:[{month:"2026-10",ventas:count*1000,unidades:count*75}],
   series:[{bucket:"2026-10",ventas:count*1000,unidades:count*75}],
   granularity:"month",kpis:{ventas:count*1000,unidades:count*75}};
 }
 else if(path==="/api/analytics/ventas/recuento")payload={totalProducts:30,totalArticles:25};
 else if(path==="/api/analytics/ventas/detalle")
  payload={products:[{id:"1|654321",pharmacyId:"1",name:"Artículo de prueba",
   cn:"654321",units:3,value:21,pvp:8,purchaseCost:2,
   saleUnitPrice:7,unitMargin:5,margin:15,abcdClass:"A"}],hasMore:false,page:1};
 else if(path==="/api/analytics/ventas/familias")payload={families:[]};
 else if(path==="/api/genericos/reales"||path==="/api/genericos/conjuntos")
  payload={groups:[],totalGroups:0,summary:{salesUnits:0,revenue:0,purchases:0},
   sales:{available:true},purchases:{available:true}};
 else if(path==="/api/ventas/catalogo")payload={products:[]};
 else if(path==="/api/ventas/cobertura")payload={pharmacies:[]};
 else if(path==="/api/ventas/seguimiento")payload={sales:{}};
 else if(path==="/api/ventas/detalle")payload={rows:[],total:0,offset:0,limit:25};
 else if(path==="/api/ventas/objetivos/buscar")payload={products:[
  {cn:"123456",description:"Producto de prueba",supplier:"Laboratorio ejemplo",sourceId:"88"}
 ]};
 else if(path==="/api/ventas/objetivos/historico"){
  const body=JSON.parse(route.request().postData()||"{}");
  payload={periods:Object.fromEntries((body.periods||[]).map(p=>
   [p.id,Object.fromEntries((body.pharmacyIds||[]).map(id=>[id,100]))])),
   amounts:Object.fromEntries((body.periods||[]).map(p=>
   [p.id,Object.fromEntries((body.pharmacyIds||[]).map(id=>[id,900]))]))};
 }
 await route.fulfill({status:200,contentType:"application/json",
   headers:{"cache-control":"no-store"},body:JSON.stringify(payload)});
}
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const failures=[];
await mkdir("responsive-artifacts",{recursive:true});
try{
 for(const viewport of sizes){
   const ctx=await browser.newContext({viewport,deviceScaleFactor:1});
   const page=await ctx.newPage();
   page.on("pageerror",err=>console.error("Error React en pruebas responsive:",err.message));
   await page.route("**/api/**",mockApi);
   // Comprobar que durante la autenticación no se dibuja la antigua maqueta de tarjetas.
   if(viewport.width===375){
     let releaseAuth;
     const authGate=new Promise(resolve=>{releaseAuth=resolve});
     await page.route("**/api/auth/me",async route=>{await authGate;await mockApi(route)});
     try{
       const authRequested=page.waitForRequest("**/api/auth/me",{timeout:12000});
       await page.goto(BASE+"/dashboard",{waitUntil:"domcontentloaded",timeout:20000});
       await authRequested;
       await page.locator(".fm-startup-screen").waitFor({state:"visible",timeout:10000});
       const splash=await page.evaluate(()=>{
         const rect=document.querySelector(".fm-startup-screen").getBoundingClientRect();
         return {top:rect.top,left:rect.left,width:rect.width,height:rect.height,
           viewportWidth:innerWidth,viewportHeight:innerHeight,
           oldCards:document.querySelectorAll(".fm-skeleton-kpis,.fm-loading-panel").length,
           shell:document.querySelectorAll(".workspace").length};
       });
       if(Math.abs(splash.top)>1||Math.abs(splash.left)>1||
          splash.width<splash.viewportWidth-1||splash.height<splash.viewportHeight-1||
          splash.oldCards||splash.shell)
         throw Error("Arranque sin pantalla completa: "+JSON.stringify(splash));
       console.log("OK 375 arranque");
     }catch(error){
       failures.push("375-arranque: "+error.message);
       console.error("FAIL 375 arranque",error.message);
     }finally{
       releaseAuth();
       await page.unroute("**/api/auth/me");
     }
   }
   for(const path of routes){
     try{
       await page.goto(BASE+"/"+path,{waitUntil:"domcontentloaded",timeout:20000});
       await page.locator(".workspace .topbar").waitFor({state:"visible",timeout:12000});
       await page.waitForTimeout(100);
       if(path==="stock-sin-recepciones")
         await page.getByRole("heading",{name:"Artículos encontrados"}).waitFor({state:"visible",timeout:12000});
       if(path==="stock")
         await page.getByText("Último inventario conocido").waitFor({state:"visible",timeout:12000});
       const result=await page.evaluate(()=>({
         viewport:window.innerWidth,
         htmlWidth:document.documentElement.scrollWidth,
         bodyWidth:document.body.scrollWidth,
         contentWidth:document.querySelector(".main-content")?.getBoundingClientRect().width,
         topbarRight:document.querySelector(".topbar-right")?.getBoundingClientRect().right,
         topbarLeft:document.querySelector(".topbar")?.getBoundingClientRect().left,
         reportHeader:(()=>{const node=document.querySelector(".fm-unified-header");
          if(!node)return null;
          const rect=node.getBoundingClientRect();
          const heading=node.querySelector(".fm-unified-heading")?.getBoundingClientRect();
          const meta=node.querySelector(".fm-unified-header-right")?.getBoundingClientRect();
          return {height:Math.round(rect.height),internalGap:heading&&meta?
           Math.round(meta.top-heading.bottom):null};
         })(),
         mobileTopGap:(()=>{
           const bar=document.querySelector(".workspace>.topbar");
           const first=document.querySelector(".workspace>.main-content")?.firstElementChild;
           return bar&&first?Math.round(first.getBoundingClientRect().top-
             bar.getBoundingClientRect().bottom):null;
         })(),
         staleStockPanel:(()=>{
           const panel=document.querySelector(".fm-stale-stock .fm-preview-panel");
           const head=panel?.querySelector(".fm-preview-panel-head h2");
           if(!panel||!head)return null;
           const a=panel.getBoundingClientRect(),b=head.getBoundingClientRect();
           return {left:Math.round(b.left-a.left),right:Math.round(a.right-b.right)};
         })(),
         table:([...document.querySelectorAll(".table-scroll")].map(e=>({
           viewport:e.clientWidth,content:e.scrollWidth}))),
       }));
       // Contrato único para todas las tablas montadas, incluidas las que
       // tienen cabecera doble con filtros y ordenación.
       const layouts=await page.locator(".fm-dual-scroll").evaluateAll(roots=>
         roots.map(root=>{
          const pane=[...root.children].find(el=>!el.classList.contains("fm-dual-scroll-top"));
          const head=pane?.querySelector("table > thead");
          return head?{
           sticky:getComputedStyle(head).position,
           vertical:getComputedStyle(pane).overflowY,
           maxHeight:getComputedStyle(pane).maxHeight,
           hasTop:!!root.querySelector(".fm-dual-scroll-top")
          }:null;
         }).filter(Boolean));
       for(const layout of layouts){
         if(layout.sticky!=="sticky"||!["auto","scroll"].includes(layout.vertical)||
            !layout.hasTop||layout.maxHeight==="none")
           throw Error("Cabecera o scroll uniforme no disponible en "+path+": "+JSON.stringify(layout));
       }
       if(path==="stock-sin-recepciones"&&(
          !result.staleStockPanel||result.staleStockPanel.left<13||
          result.staleStockPanel.right<13))
         throw Error("Stock sin recepciones sin márgenes: "+JSON.stringify(result.staleStockPanel));
       const excess=Math.max(result.htmlWidth,result.bodyWidth)-result.viewport;
       if(excess>2||result.topbarRight>result.viewport+2){
         throw Error("Desbordamiento de "+excess+"px; "+JSON.stringify(result));
       }
       if(viewport.width<=560&&["promociones","dashboard","ventas"].includes(path)&&
          (result.mobileTopGap===null||result.mobileTopGap>55||result.mobileTopGap<0))
         throw Error("Hueco superior móvil: "+result.mobileTopGap+"px");

       if(path==="dashboard"&&viewport.width<=560&&result.reportHeader&&
          (result.reportHeader.height>205||result.reportHeader.internalGap>40))
         throw Error("Cabecera de Inicio anormalmente alta: "+JSON.stringify(result.reportHeader));

       if(path==="promociones"&&viewport.width<=560&&
          !result.table.some(t=>t.content>t.viewport)){
         throw Error("La tabla de promociones debería desplazarse dentro de su tarjeta");
       }
       if(path==="promociones/simulador"&&viewport.width===375){
         const headers=await page.locator(".fm-objectives-base input[type=radio]").count();
         if(headers!==4)throw Error("El simulador necesita cuatro períodos con selector de referencia");
         const paste=page.locator(".fm-objectives-search textarea");
         await paste.fill("123456");
         await page.locator(".fm-objectives-results").waitFor({state:"visible",timeout:10000});
         await page.getByRole("button",{name:"Seleccionar CN disponibles"}).click();
         await page.getByRole("radio",{name:"Usar Mismo mes hace 1 año como base de objetivos"}).check();
         const compact=await page.evaluate(()=>{
           const table=document.querySelector(".fm-objectives-unified-table");
           const rate=document.querySelector(".fm-objectives-rate-line");
           const rateInput=rate?.querySelector("input");
           const objective=document.querySelector(".fm-objectives-goal-cell input");
           const extract=document.querySelector(".fm-sales-simulator");
           const exports=extract?.querySelector(".fm-sales-export-actions");
           return {
             text:table?.querySelector("tbody")?.textContent||"",
             rateWrap:rate?getComputedStyle(rate).flexWrap:null,
             rateWidth:rateInput?.getBoundingClientRect().width||0,
             objectiveWidth:objective?.getBoundingClientRect().width||0,
             extraLabel:rate?.textContent?.includes("Otro"),
             hasExplanation:Boolean(extract?.querySelector(".fm-sales-period-info,.lab-detail-money-help")),
             dateColumn:[...(extract?.querySelectorAll(".data-table thead tr:first-child th")||[])]
               .some(th=>th.textContent.includes("Fecha y hora")),
             exportCount:exports?.querySelectorAll("button").length||0,
             exportAligned:Boolean(exports&&exports.getBoundingClientRect().right<=
               extract.getBoundingClientRect().right+1)
           };
         });
         if(/uds\.|€|netos/.test(compact.text))throw Error("La tabla debe mostrar solo unidades numéricas");
         if(compact.rateWrap!=="nowrap"||compact.extraLabel||compact.rateWidth>75)
           throw Error("Incrementos sin compactar: "+JSON.stringify(compact));
         if(compact.objectiveWidth>85)throw Error("El campo de objetivo no es compacto");
         if(compact.hasExplanation||compact.dateColumn)
           throw Error("La extracción del Simulador mantiene fechas o textos explicativos");
         if(compact.exportCount!==2||!compact.exportAligned)
           throw Error("Las exportaciones deben quedar agrupadas a la derecha");

         await page.getByRole("button",{name:"Crear promoción",exact:true}).click();
         await page.locator(".drawer").waitFor({state:"visible",timeout:10000});
         const transferred=await page.locator(".drawer textarea.cn-area").inputValue();
         if(!transferred.includes("123456"))throw Error("Los CN no se transfieren al formulario lateral");
         const targets=await page.locator(".drawer .target-row").count();
         if(targets!==pharmacies.length)throw Error("Las farmacias no se transfieren al panel: "+targets);
         await page.locator(".drawer-top button[aria-label=Cerrar]").click();
         if(await page.locator(".drawer-backdrop").count())throw Error("El formulario no se puede cerrar");
         await paste.fill("");
         const placeholder=await paste.getAttribute("placeholder");
         if(!placeholder||!placeholder.includes("123456"))
           throw Error("No se recupera el placeholder al vaciar los CN");
       }
       if(path==="promociones"&&viewport.width===375){
         const paired=await page.locator(".fm-dual-scroll").first().evaluate(root=>{
           const top=root.querySelector(".fm-dual-scroll-top");
           const bottom=root.querySelector(".table-scroll");
           if(!top||!bottom)return {ok:false,reason:"faltan barras"};
           top.scrollLeft=85;top.dispatchEvent(new Event("scroll"));
           return {ok:Math.abs(bottom.scrollLeft-top.scrollLeft)<=1&&
            top.scrollWidth>top.clientWidth,reason:"barras no sincronizadas"};
         });
         if(!paired.ok)throw Error("El scroll superior e inferior debe estar sincronizado: "+paired.reason);
       }
       if(path==="promociones"&&viewport.width===375){
         const metrics=page.locator(".campaign-metrics .campaign-metric strong");
         await metrics.first().waitFor({state:"visible",timeout:10000});
         const count=Number((await metrics.nth(0).textContent()).replace(/\D/g,""));
         const cn=Number((await metrics.nth(1).textContent()).replace(/\D/g,""));
         const targets=Number((await metrics.nth(2).textContent()).replace(/\D/g,""));
         // Un cliente sin promociones es válido: no crear campañas ficticias
         // solo para que los KPI tengan números mayores que cero.
         if(![count,cn,targets].every(Number.isFinite))
           throw Error("KPI de promociones no numéricos: "+count+"/"+cn+"/"+targets);
       }
       if(path==="promociones"&&viewport.width===375){
         const quick=page.getByRole("group",{name:"Períodos rápidos"});
         if(await quick.getByRole("button").count()!==5)
           throw Error("Promociones debe incluir cinco accesos rápidos");
         await quick.getByRole("button",{name:"Este mes",exact:true}).click();
         const dates=await page.locator(".fm-unified-filters input[type=date]").evaluateAll(
           els=>els.map(el=>el.value));
         if(dates.length!==2||!dates.every(date=>/^20\d{2}-\d{2}-\d{2}$/.test(date)))
           throw Error("Los accesos de promociones deben aplicar las fechas Desde/Hasta");
         if(await quick.getByRole("button",{name:"Este mes",exact:true}).getAttribute("aria-pressed")!=="true")
           throw Error("El acceso rápido debe mostrarse seleccionado");
       }
       if(["dashboard","ventas","compras","proveedores","stock","reposicion",
         "genericos","rentabilidad","informes"].includes(path)&&viewport.width===375){
         // El shell aparece antes del módulo lazy: 100 ms no garantizan los filtros.
         const quick=page.getByRole("group",{name:"Períodos rápidos"});
         await quick.getByRole("button").first().waitFor({state:"visible",timeout:10000});
         const count=await quick.getByRole("button").count();
         if(count!==5)throw Error("Faltan accesos rápidos en "+path+": "+count);
       }
       if(path==="dashboard"&&viewport.width===375){
         const firstMetric=page.locator(".fm-demo-kpi").first().locator("strong");
         await page.waitForFunction(()=>document.querySelector(".fm-demo-kpi strong")?.textContent!=="—");
         const before=await firstMetric.textContent();
         await page.locator(".fm-unified-filters .multi-filter-trigger").first().click();
         const popup=page.locator(".multi-filter-popover");
         await popup.getByText("Abadía",{exact:true}).click();
         await popup.getByText("Europa",{exact:true}).click();
         await popup.getByRole("button",{name:"Listo"}).click();
         await page.waitForFunction(previous=>{const now=document.querySelector(".fm-demo-kpi strong")?.textContent;return Boolean(now&&now!==previous&&now!=="—");},before,{timeout:10000});
         const after=await firstMetric.textContent();
         if(before===after)throw Error("La selección de dos farmacias no recalcula los KPI");
         await page.locator(".fm-demo-kpi").first().click();
         await page.getByRole("heading",{name:"Ventas",exact:true}).waitFor();
       }
       if(path==="promociones"&&viewport.width<=768){
         const toggle=page.locator(".mobile-toggle");
         await toggle.click();
         await page.locator(".sidebar.sidebar-open").waitFor({state:"visible"});
         const scroll=await page.locator(".side-nav").evaluate(el=>({
           scrollHeight:el.scrollHeight,clientHeight:el.clientHeight}));
         if(scroll.scrollHeight>scroll.clientHeight){
           await page.locator(".side-nav").evaluate(el=>el.scrollTop=el.scrollHeight);
         }
         await page.keyboard.press("Escape");
         if(await page.locator(".sidebar.sidebar-open").count())
           throw Error("El menú móvil no se cierra al pulsar Escape");
       }
       console.log("OK",viewport.width,path);
     }catch(error){
       const id=viewport.width+"-"+path.replaceAll("/","-");
       failures.push(id+": "+error.message);
       await page.screenshot({path:"responsive-artifacts/"+id+".png",
         fullPage:true,timeout:5000}).catch(()=>{});
       console.error("FAIL",id,error.message);
     }
   }
   // El mismo superadministrador no debe ver IA en un cliente desactivado.
   if([375,1440].includes(viewport.width)){
    try{
     await page.goto(BASE+"/dashboard",{waitUntil:"domcontentloaded"});
     const launcher=page.getByRole("button",{name:"Abrir asistente de Farmétrica"});
     await launcher.waitFor({state:"visible",timeout:12000});
     const selector=page.getByRole("combobox",{name:"Cambiar de cliente"});
     await selector.selectOption("cliente_demo");
     await launcher.waitFor({state:"detached",timeout:12000});
     if(await page.locator(".fm-ai-root").count())
      throw Error("El diálogo del asistente permanece en un cliente desactivado");
     await selector.selectOption("ampedia");
     await launcher.waitFor({state:"visible",timeout:12000});
     console.log("OK",viewport.width,"asistente por cliente");
    }catch(error){
     failures.push(viewport.width+"-permisos-asistente: "+error.message);
     console.error("FAIL",viewport.width,"asistente por cliente",error.message);
    }
   }
   await ctx.close();
 }
}finally{await browser.close()}
if(failures.length){
 console.error("\n"+failures.length+" errores de diseño responsive:\n"+failures.join("\n"));
 process.exitCode=1;
}else console.log("\nTodas las páginas caben en pantalla; tablas desplazables.");
