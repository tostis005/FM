import {solutions,integrations,articles} from "./seo-content.mjs";
import {readFileSync} from "node:fs";
import assert from "node:assert/strict";

const read=path=>readFileSync(new URL(path,import.meta.url),"utf8");
const home=read("./public/landing.html");
const blog=read("./public/blog/index.html");
const login=read("./login.html");
const nginx=read("./nginx.conf");
const css=read("./public/marketing.css");
const emblem=read("./public/brand-symbol.svg");
const favicon=read("./public/favicon.svg");
const logoBinary=readFileSync(new URL("./public/brand-logo.webp",import.meta.url));
assert.equal(logoBinary.toString("ascii",0,4),"RIFF");
assert.equal(logoBinary.toString("ascii",8,12),"WEBP");
assert.match(nginx,/location = \/brand-logo\.webp/);
assert.match(emblem,/<svg/);
assert.match(emblem,/<path/);
assert.match(favicon,/Farmetrica/);
assert.match(css,/\.fm-emblem/);
const demo=read("./public/solicitar-demo/index.html");
const leadScript=read("./public/solicitar-demo/formulario.js");
assert.match(demo,/id="demo-request-form"/);
assert.match(demo,/consentimiento/);
assert.match(demo,/name="programa"/);
assert.match(leadScript,/\/api\/public\/solicitudes-demo/);
assert.match(nginx,/location \^~ \/solicitar-demo\/ /);
assert.match(nginx,/location \^~ \/privacidad\/ /);
assert.match(read("./public/privacidad/index.html"),/Ejercicio de derechos|Ejercitar|ejerce|ejercer tus derechos/i);
assert.match(read("./public/privacidad/solicitud/index.html"),/id="privacy-request-form"/);
assert.match(nginx,/\/solicitar-demo\//);
assert.match(home,/solicitar-demo\/\?origen=landing/);
assert.match(css,/\.demo-form-shell/);
assert.match(read("./generate-seo.mjs"),/Solicitar demo/);
assert.match(nginx,/location = \/brand-symbol\.svg/);
assert.match(login,/<img class="fm-emblem" src="\/brand-logo\.webp\?v=4"/);
assert.doesNotMatch(home,/✳/,"La portada no debe mostrar el isotipo antiguo");
assert.doesNotMatch(login,/✳/,"El acceso no debe mostrar el isotipo antiguo");
assert.match(home,/<img class="fm-emblem" src="\/brand-logo\.webp\?v=4"/,"La cabecera principal dibuja el nuevo logo");
assert.match(blog,/<img class="fm-emblem" src="\/brand-logo\.webp\?v=4"/,"El blog dibuja el nuevo logo");
assert.doesNotMatch(css,/mask:url\(\/"brand-symbol/,"No se debe depender de máscaras CSS");


const posts=[
  "presentamos-farmetrica",
  "objetivos-por-farmacia",
  "datos-reales-integraciones",
];
for(const [name,html] of [["landing",home],["blog",blog]]){
  assert.match(html,/<html lang="es">/);
  assert.match(html,/<meta name="description"/);
  assert.match(html,/<link rel="stylesheet" href="\/marketing.css\?v=6">/);
  assert.match(html,/href="\/login"/);
  assert.doesNotMatch(html,/<script[^>]+src="\/assets\//);
}
assert.match(home,/<h1 id="hero-title">/);
assert.match(home,/Farmatic/);
assert.match(home,/Nixfarma/);
assert.match(home,/Unycop/);
assert.match(home,/Toda tu farmacia, <em>en una sola visión/);
assert.match(home,/Mejores decisiones/);
assert.match(home,/Stock e inventario/);
assert.match(home,/Proveedores/);
assert.match(home,/Genéricos/);
assert.match(home,/Rentabilidad/);
assert.match(home,/Una farmacia/);
assert.match(home,new RegExp('href="/integraciones/bitfarma/"'));
assert.match(home,new RegExp('href="/integraciones/farmanager/"'));
assert.match(home,/la conexión depende de la versión, permisos y validación técnica/);
assert.match(css,/@media\(max-width:700px\)/);
assert.match(login,/query\.get\("next"\) \|\| "\/dashboard"/);
assert.match(login,/next === "\/" \? "\/dashboard"/);
for(const slug of posts){
  const html=read("./public/blog/"+slug+"/index.html");
  assert.match(blog,new RegExp('href="/blog/'+slug+'/?"'));
  assert.match(html,/Equipo Farmetrica/);
  assert.match(html,/<article class="article-wrap">/);
  assert.match(html,/href="\/login"/);
  assert.ok(html.length>2300,slug+" debe contener un artículo completo");
}
assert.match(nginx,/location = \/brand-symbol\.svg/);
assert.match(nginx,/try_files \/landing\.html =404;/);
assert.match(nginx,/location \^~ \/blog\/ \{/);
assert.match(nginx,/location = \/brand-symbol\.svg/);
assert.match(nginx,/location = \/brand-symbol\.svg/);
assert.match(nginx,/location = \/brand-symbol\.svg/);
assert.match(nginx,/location \/ \{\s*auth_request \/__authcheck;/);
assert.match(nginx,/error_page 401 = @login_redirect;/);
assert.match(nginx,/Disallow: \/dashboard/, "Las áreas privadas no deben indexarse");

const pages=[
  ...solutions.map(x=>({p:x,url:"/soluciones/"+x.slug+"/",type:"solution"})),
  ...integrations.map(x=>({p:x,url:"/integraciones/"+x.slug+"/",type:"integration"})),
  ...articles.map(x=>({p:x,url:"/blog/"+x.slug+"/",type:"article"})),
];
const allUrls=new Set(pages.map(x=>x.url));
assert.equal(allUrls.size,pages.length,"URLs públicas sin duplicados");
const titleSet=new Set(),descriptionSet=new Set();
for(const {p,url,type} of pages){
  const html=read("./public"+url+"index.html");
  assert.ok(html.length>2600,"Contenido editorial insuficiente: "+url);
  assert.match(html,/<html lang="es">/);
  assert.match(html,/<h1>/);
  assert.match(html,/<meta name="description"/);
  assert.match(html,/<link rel="canonical" href="/);
  assert.match(html,/<script type="application\/ld\+json">/);
  assert.match(html,/<meta name="robots" content="index,follow/);
  assert.match(html,/href="\/login"/);
  assert.doesNotMatch(html,/Farmétrica|FARMAWAO|FarmaWow/);
  assert.doesNotMatch(html,/href="\/assets\//);
  assert.doesNotMatch(html,/<script[^>]+src="\/assets\//);
  assert.ok(!titleSet.has(p.title),"Título duplicado: "+p.title);titleSet.add(p.title);
  assert.ok(!descriptionSet.has(p.description),"Descripción duplicada: "+url);descriptionSet.add(p.description);
  if(type==="article")assert.match(html,/"@type":"BlogPosting"/);
  if(type==="integration"){
    assert.match(html,/Origen Farmatic conectado|Conexión sujeta a validación por instalación/);
    if(p.slug!=="farmatic")assert.match(html,/Conexión sujeta a validación por instalación/);
  }
  for(const related of p.related||[])assert.ok(allUrls.has(related)||["/","/soluciones/","/integraciones/","/blog/"].includes(related),"Enlace contextual desconocido: "+related);
  assert.ok(nginx.includes(url),"Sitemap: falta "+url);
}
for(const section of ["/soluciones/","/integraciones/"]){
  const html=read("./public"+section+"index.html");
  assert.match(html,/<h1>/);
  assert.match(html,/<meta name="description"/);
  assert.match(html,/<link rel="canonical" href="/);
  assert.ok(nginx.includes(section),"Sitemap: falta "+section);
}
for(const article of articles){
  assert.match(blog,new RegExp('href="/blog/'+article.slug+'/"'));
  assert.match(home,/href="\/soluciones\/gestion-promociones-farmacia\/"/);
}
assert.match(nginx,/location = \/brand-symbol\.svg/);
assert.match(nginx,/location \^~ \/soluciones\/ \{/);
assert.match(nginx,/location \^~ \/integraciones\/ \{/);
assert.match(nginx,/Sitemap: \$public_scheme:\/\/\$host\/sitemap\.xml/);
assert.match(nginx,/location \/ \{\s*auth_request \/__authcheck;/);

console.log("Marketing público y panel privado: estructura y navegación verificadas");

const commercialModules=["ventas-farmacia","analisis-compras-farmacia","rentabilidad-farmacia","control-stock-farmacia",
  "reposicion-stock-farmacia","analisis-proveedores-farmacia","comparativa-genericos-farmacia","rendimiento-articulos-farmacia"];
for(const slug of commercialModules){
 assert.match(home,new RegExp('href="/soluciones/'+slug+'/"'),"Landing sin solución "+slug);
 assert.ok(solutions.some(p=>p.slug===slug),"Ficha SEO ausente "+slug);
}
for(const slug of ["bitfarma","farmanager"]){
 assert.ok(integrations.some(p=>p.slug===slug));
 assert.match(home,new RegExp('href="/integraciones/'+slug+'/"'));
}
for(const slug of ["compras-inteligentes-farmacia","stock-inmovilizado-farmacia","rentabilidad-por-articulo","estrategia-genericos-farmacia"]){
 assert.ok(articles.some(p=>p.slug===slug));
 assert.match(blog,new RegExp('href="/blog/'+slug+'/"'));
}
assert.doesNotMatch(home,/FARMAWAO|FarmaWow|Farmétrica|Integración en estudio|Vista de ejemplo|prototipo/i);
assert.match(css,/\.suite-grid/);
assert.match(css,/\.business-product-preview/);
assert.match(css,/@media\(max-width:480px\)/);

// Publicaciones SEO orientadas a intención de compra e integración técnica.
for(const target of ["/soluciones/business-intelligence-farmacias/","/blog/integrar-farmatic-nixfarma-unycop-analitica/"]){
 assert.match(nginx,new RegExp(target.replaceAll("/","\\/")));
 const content=read("./public"+target+"index.html");
 assert.match(content,/<h1>/);
 assert.match(content,/Farmetrica/);
 assert.ok(content.length>6500,target+" necesita contenido editorial propio");
 assert.doesNotMatch(content,/integración universal|conector probado para todos|todos los sistemas conectados/i);
}
assert.match(home,/href="\/soluciones\/business-intelligence-farmacias\/"/);
assert.match(home,/href="\/blog\/integrar-farmatic-nixfarma-unycop-analitica\/"/);
assert.match(blog,/href="\/blog\/integrar-farmatic-nixfarma-unycop-analitica\/"/);

// La narrativa principal es inteligencia de negocio, no únicamente campañas.
assert.match(home,/Toda tu farmacia, <em>en una sola visión/);
assert.match(login,/espacio de inteligencia de negocio/);
assert.doesNotMatch(login,/panel de promociones y seguimiento/);
assert.match(blog,/Presentamos Farmetrica: una visión integral de tu farmacia/);
const source=read("./src/main.jsx");
assert.match(source,/return ROUTES.has\(path\)\?path:"dashboard"/);
const promotedPages=["cuadro-mando-farmacias","grupos-de-farmacias","gestion-usuarios-farmacias","farmatic"];
for(const slug of promotedPages){
 const rec=[...solutions,...integrations].find(x=>x.slug===slug);
 assert.ok(rec,"No se encuentra "+slug);
 assert.match(rec.description,/ventas|compras|stock|módulos|accesos|datos/i);
}
const seoGenerator=read("./generate-seo.mjs");
assert.match(seoGenerator,/Compras y proveedores\|Costes y oportunidades/);
assert.match(seoGenerator,/Mejorar compras y márgenes/);

// Comprobar toda la cobertura orgánica de funciones generales y preguntas de análisis.
const intentSolutions=["software-analitica-farmacias","comparar-farmacias-red"];
const intentArticles=["kpis-gestion-farmacia","excel-power-bi-farmacia","calcular-margen-farmacia","rotacion-cobertura-stock-farmacia","analizar-compras-proveedores-farmacia","ia-analisis-datos-farmacia"];
for(const slug of intentSolutions){assert.ok(solutions.some(x=>x.slug===slug));assert.match(home,new RegExp('href="/soluciones/'+slug+'/"'));assert.ok(nginx.includes('/soluciones/'+slug+'/'));}
for(const slug of intentArticles){assert.ok(articles.some(x=>x.slug===slug));assert.match(blog,new RegExp('href="/blog/'+slug+'/"'));assert.ok(nginx.includes('/blog/'+slug+'/'));}
assert.match(home,/Software de análisis para farmacias/);
assert.match(home,/id="herramientas-analisis"/);
assert.ok(home.indexOf('/soluciones/ventas-farmacia/')<home.indexOf('/soluciones/gestion-promociones-farmacia/'));
