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
