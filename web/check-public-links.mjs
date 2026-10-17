// Auditoría estricta de enlaces internos después de generar el sitio editorial.
import {readFileSync,existsSync,readdirSync} from "node:fs";
import {join,resolve,relative,extname} from "node:path";
import assert from "node:assert/strict";
const root=resolve(import.meta.dirname,"public");
const origin="https://farmetrica.local";
const errors=[];
const files=[];
function walk(dir){
 for(const d of readdirSync(dir,{withFileTypes:true})){
  const path=join(dir,d.name);
  if(d.isDirectory())walk(path);
  else if(d.name.endsWith(".html"))files.push(path);
 }
}
walk(root);
const generatedRoutes=new Set(files.map(file=>{
 const p="/"+relative(root,file).replaceAll("\\","/").replace(/index\.html$/,"");
 return p==="/landing.html"?"/":p;
}));
const allFiles=new Set();
function walkAll(dir){
 for(const d of readdirSync(dir,{withFileTypes:true})){
  const path=join(dir,d.name);if(d.isDirectory())walkAll(path);
  else allFiles.add("/"+relative(root,path).replaceAll("\\","/"));
 }
}
walkAll(root);
const special=new Set(["/login","/promociones","/seguimiento","/dashboard","/ventas","/compras","/usuarios","/farmacias","/ajustes","/proveedores","/reposicion","/stock","/informes","/asistente","/genericos","/rentabilidad","/accesos","/clientes","/solicitudes"]);
const known=new Set([...generatedRoutes,...allFiles,...special,"/sitemap.xml","/robots.txt"]);
const anchorByRoute=new Map();
for(const file of files){
 const path="/"+relative(root,file).replaceAll("\\","/").replace(/index\.html$/,"");
 const route=path==="/landing.html"?"/":path;
 const html=readFileSync(file,"utf8");
 anchorByRoute.set(route,new Set([...html.matchAll(/\bid=["']([^"']+)["']/g)].map(x=>x[1])));
}
for(const file of files){
 const path="/"+relative(root,file).replaceAll("\\","/").replace(/index\.html$/,"");
 const page=path==="/landing.html"?"/":path;
 const html=readFileSync(file,"utf8");
 for(const match of html.matchAll(/\b(?:href|src|action)=["']([^"']+)["']/g)){
   const ref=match[1];
   if(ref.startsWith("#") && ref.length===1)continue;
   if(/^(?:mailto:|tel:|javascript:|data:)/i.test(ref))continue;
   let url;try{url=new URL(ref,origin+page)}catch{errors.push(page+" URL inválida: "+ref);continue}
   if(url.origin!==origin)continue;
   const uri=url.pathname;
   if(uri.startsWith("/api/"))continue;
   if(!known.has(uri)&&!known.has(uri+"/")){
      errors.push(page+" -> "+ref+" (destino inexistente: "+uri+")");continue;
   }
   if(url.hash && uri.endsWith("/") && anchorByRoute.has(uri)){
     const id=decodeURIComponent(url.hash.slice(1));
     if(!anchorByRoute.get(uri).has(id))errors.push(page+" -> "+ref+" (ancla inexistente)");
   }
 }
}
const expectedIntegrations=["farmatic","nixfarma","unycop","bitfarma","farmanager"];
for(const slug of expectedIntegrations)if(!generatedRoutes.has("/integraciones/"+slug+"/"))
 errors.push("Falta la integración publicada: "+slug);
const uniq=[...new Set(errors)];
if(uniq.length){console.error("Enlaces rotos ("+uniq.length+"):\n"+uniq.join("\n"));process.exitCode=1}
else console.log("Enlaces públicos revisados: "+files.length+" páginas HTML, "+expectedIntegrations.length+" integraciones, 0 enlaces o anclas rotos.");
