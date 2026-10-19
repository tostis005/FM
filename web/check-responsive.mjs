// Pruebas visuales de desbordamiento horizontal en viewport reales.
// Ejecutar con: npm install --no-save playwright && npx playwright install chromium
//                npm run dev -- --port 4175   (en otra terminal)
//                node check-responsive.mjs
import {chromium} from "playwright";
import {mkdir} from "node:fs/promises";
const BASE=process.env.RESPONSIVE_BASE_URL||"http://127.0.0.1:4175";
const routes=[
 "promociones","promociones/seguimiento","dashboard","ventas","compras",
 "proveedores","stock","reposicion","genericos","rentabilidad","acciones",
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
    ? {slug:"cliente_demo",name:"Cliente de pruebas",schema:"cliente_demo"}:context.client};
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
   salesRows:[product],buyRows:[],supplierRows:[],stockRows:[],replenishmentRows:[],
   profitRows:[product],actions:[],families:[],
   availability:{sales:true,purchases:true,stock:false,rowsTruncated:false}};
 }
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
   for(const path of routes){
     try{
       await page.goto(BASE+"/"+path,{waitUntil:"domcontentloaded",timeout:20000});
       await page.locator(".workspace .topbar").waitFor({state:"visible",timeout:12000});
       await page.waitForTimeout(100);
       const result=await page.evaluate(()=>({
         viewport:window.innerWidth,
         htmlWidth:document.documentElement.scrollWidth,
         bodyWidth:document.body.scrollWidth,
         contentWidth:document.querySelector(".main-content")?.getBoundingClientRect().width,
         topbarRight:document.querySelector(".topbar-right")?.getBoundingClientRect().right,
         topbarLeft:document.querySelector(".topbar")?.getBoundingClientRect().left,
         table:([...document.querySelectorAll(".table-scroll")].map(e=>({
           viewport:e.clientWidth,content:e.scrollWidth}))),
       }));
       const excess=Math.max(result.htmlWidth,result.bodyWidth)-result.viewport;
       if(excess>2||result.topbarRight>result.viewport+2){
         throw Error("Desbordamiento de "+excess+"px; "+JSON.stringify(result));
       }
       if(path==="promociones"&&viewport.width<=560&&
          !result.table.some(t=>t.content>t.viewport)){
         throw Error("La tabla de promociones debería desplazarse dentro de su tarjeta");
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
   await ctx.close();
 }
}finally{await browser.close()}
if(failures.length){
 console.error("\n"+failures.length+" errores de diseño responsive:\n"+failures.join("\n"));
 process.exitCode=1;
}else console.log("\nTodas las páginas caben en pantalla; tablas desplazables.");
