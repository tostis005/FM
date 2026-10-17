// Revisión visual automatizada de la web pública en dimensiones reales.
import {chromium} from "playwright";
import {mkdir} from "node:fs/promises";

const base=process.env.RESPONSIVE_BASE_URL||"http://127.0.0.1:4175";
const routes=["/landing.html","/soluciones/","/integraciones/","/blog/",
  "/soluciones/rentabilidad-farmacia/","/soluciones/control-stock-farmacia/",
  "/blog/compras-inteligentes-farmacia/"];
const viewports=[
 {width:320,height:740},{width:375,height:812},{width:414,height:896},
 {width:768,height:1024},{width:1024,height:768},{width:1440,height:900}
];
const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
const failures=[];
await mkdir("responsive-artifacts/public",{recursive:true});
try{
 for(const viewport of viewports){
  const context=await browser.newContext({viewport,deviceScaleFactor:1});
  const page=await context.newPage();
  for(const path of routes){
   try{
    const response=await page.goto(base+path,{waitUntil:"networkidle",timeout:25000});
    if(!response?.ok())throw Error("HTTP "+response?.status());
    const details=await page.evaluate(()=>{
      const width=window.innerWidth,html=document.documentElement.scrollWidth,body=document.body.scrollWidth;
      const login=document.querySelector(".site-nav .login-button");
      const main=document.querySelector("#contenido");
      const h1=main?.querySelector("h1");
      const nav=document.querySelector(".site-nav");
      const rect=el=>el?.getBoundingClientRect();
      return {width,html,body,login:rect(login),h1:rect(h1),nav:rect(nav),
        links:[...document.querySelectorAll('a[href^="/"]')].length};
    });
    if(Math.max(details.html,details.body)-viewport.width>3)
      throw Error("Scroll horizontal global: "+JSON.stringify(details));
    if(!details.h1||details.h1.right>viewport.width+2||details.h1.left<0)
      throw Error("Titular fuera del viewport: "+JSON.stringify(details));
    if(!details.login||details.login.right>viewport.width+2||details.login.left<0)
      throw Error("Acceso fuera de cabecera: "+JSON.stringify(details));
    if(!details.links)throw Error("Página pública sin navegación");
    if(path==="/landing.html"){
      if(!await page.getByRole("heading",{level:1}).count())throw Error("Falta H1");
      if(viewport.width<=414){
        await page.locator(".mobile-nav summary").click();
        await page.locator(".mobile-nav .mobile-links").waitFor({state:"visible"});
        const menu=await page.locator(".mobile-nav .mobile-links").boundingBox();
        if(!menu||menu.x<0||menu.x+menu.width>viewport.width+2)
          throw Error("Menú móvil fuera del viewport");
        await page.locator(".mobile-nav summary").click();
      }
    }
    console.log("OK web pública",path,viewport.width);
   }catch(error){
    const id=viewport.width+"-"+path.replaceAll("/","-").replaceAll(".html","");
    failures.push(id+": "+error.message);
    await page.screenshot({path:"responsive-artifacts/public/"+id+".png",fullPage:true}).catch(()=>{});
    console.error("FAIL",id,error.message);
   }
  }
  await context.close();
 }
}finally{await browser.close();}
if(failures.length){
 console.error(failures.length+" fallos responsive público:\n"+failures.join("\n"));
 process.exitCode=1;
}else console.log("Portada, SEO y blog: comprobados en móvil, tablet y escritorio");
