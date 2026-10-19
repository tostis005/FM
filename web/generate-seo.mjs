import {mkdirSync,writeFileSync,readFileSync,readdirSync} from "node:fs";
import {join,resolve,relative,dirname} from "node:path";
import {solutions,integrations,articles} from "./seo-content.mjs";
const root=resolve(import.meta.dirname,"public");
const esc=x=>String(x??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
const typePath=t=>t==="article"?"blog":t==="integration"?"integraciones":"soluciones";
const records=[
 ...solutions.map(p=>({...p,type:"solution",url:"/soluciones/"+p.slug+"/"})),
 ...integrations.map(p=>({...p,type:"integration",url:"/integraciones/"+p.slug+"/"})),
 ...articles.map(p=>({...p,type:"article",url:"/blog/"+p.slug+"/"}))
];
const hubRecords=[
 {url:"/",title:"Conoce Farmetrica",category:"Inicio",description:"Inteligencia de negocio para farmacias: ventas, compras, márgenes, stock, proveedores y rendimiento de artículos."},
 {url:"/soluciones/",title:"Todas las soluciones de Farmetrica",category:"Soluciones",description:"Soluciones de análisis de ventas, compras, stock, reposición, proveedores, artículos y rentabilidad para farmacias."},
 {url:"/integraciones/",title:"Programas de gestión e integraciones",category:"Integraciones",description:"Descubre las opciones de conectividad de Farmetrica con Farmatic, Unycop, Nixfarma, Bitfarma y otros programas de gestión."},
 {url:"/blog/",title:"Blog de Farmetrica",category:"Blog",description:"Guías sobre ventas, compras, proveedores, stock y rentabilidad para gestionar mejor la farmacia."}
];
const byUrl=new Map([...records,...hubRecords].map(p=>[p.url,p]));
const brandIcon='<img class="fm-emblem" src="/brand-logo.webp?v=4" alt="" loading="eager" decoding="async">';
const nav='<header class="site-nav"><div class="container"><a class="logo" href="/" aria-label="Farmetrica, inicio"><span class="logo-symbol" aria-hidden="true">'+brandIcon+'</span>Farmetrica</a><nav class="nav-links" aria-label="Navegación"><a href="/soluciones/">Soluciones</a><a href="/integraciones/">Integraciones</a><a href="/blog/">Blog</a></nav><div class="nav-actions"><a class="nav-demo-button" href="/solicitar-demo/?origen=seo">Solicitar demo <span aria-hidden="true">↗</span></a><a class="login-button" href="/login">Acceder</a><details class="mobile-nav"><summary aria-label="Abrir menú de navegación">☰</summary><nav class="mobile-links"><a href="/solicitar-demo/?origen=seo">Solicitar demostración</a><a href="/">Inicio</a><a href="/soluciones/">Soluciones</a><a href="/integraciones/">Integraciones</a><a href="/blog/">Blog</a></nav></details></div></div></header>';
const footer='<footer class="footer"><div class="container"><div class="footer-top"><a class="logo" href="/"><span class="logo-symbol" aria-hidden="true">'+brandIcon+'</span>Farmetrica</a><nav class="footer-nav" aria-label="Pie de página"><a href="/soluciones/">Soluciones</a><a href="/integraciones/">Integraciones</a><a href="/blog/">Blog</a><a href="/privacidad/">Privacidad</a><a href="/solicitar-demo/?origen=footer">Solicitar demostración</a><a href="/login">Acceder</a></nav></div><div class="footer-small"><span>© 2026 Farmetrica · Inteligencia comercial para farmacias</span><span>Ventas, compras, stock y rentabilidad en contexto.</span></div></div></footer>';
const jsonld=value=>'<script type="application/ld+json">'+JSON.stringify(value).replace(/</g,"\\u003c")+'</script>';
function head(title,description,canonical,type,extra=""){
 return '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#102f28"><meta name="robots" content="index,follow,max-image-preview:large"><meta name="description" content="'+esc(description)+'"><title>'+esc(title)+' | Farmetrica</title><meta property="og:locale" content="es_ES"><meta property="og:site_name" content="Farmetrica"><meta property="og:type" content="'+(type==="article"?"article":"website")+'"><meta property="og:title" content="'+esc(title)+'"><meta property="og:description" content="'+esc(description)+'"><link rel="canonical" href="'+esc(canonical)+'"><link rel="icon" type="image/webp" href="/brand-logo.webp?v=4"><link rel="stylesheet" href="/marketing.css?v=7"><script defer src="/metricas.js?v=1"></script>'+extra+'</head><body><a class="skip-link" href="#contenido">Saltar al contenido</a>'+nav;
}
function cards(items){
 return '<div class="seo-card-grid">'+items.map(p=>'<a class="seo-card" href="'+p.url+'"><span class="seo-card-eyebrow">'+esc(p.category)+'</span><h3>'+esc(p.title)+'</h3><p>'+esc(p.description)+'</p><span class="seo-card-link">Descubrir más <span aria-hidden="true">↗</span></span></a>').join("")+'</div>';
}
const cta='<div class="seo-cta"><div><span class="section-label">Farmetrica</span><h2>Una visión completa. Decisiones que importan.</h2><p>Conoce cómo unificar ventas, compras, existencias, proveedores y rentabilidad para detectar oportunidades de ahorro y mejora.</p></div><div class="seo-cta-buttons"><a class="button button-mint" href="/solicitar-demo/?origen=seo">Solicitar demostración ↗</a><a class="button button-outline" href="/soluciones/">Explorar soluciones →</a></div></div>';
function hero(p,crumbs){
 const crumbsHtml=crumbs.slice(0,-1).map(c=>'<a href="'+c.href+'">'+esc(c.name)+'</a>').join(' <span aria-hidden="true">/</span> ');
 return '<section class="seo-hero"><div class="container"><nav class="breadcrumb seo-crumb" aria-label="Ruta de navegación">'+crumbsHtml+' <span aria-hidden="true">/</span> <span aria-current="page">'+esc(p.category)+'</span></nav><div class="seo-hero-layout"><div><span class="seo-kicker"><span class="seo-kicker-dot"></span>'+esc(p.category)+'</span><h1>'+esc(p.hero)+'</h1><p>'+esc(p.lead)+'</p><div class="hero-actions"><a class="button button-mint" href="#detalle">'+(p.type==="article"?"Leer guía":"Conocer la solución")+' <span aria-hidden="true">↓</span></a><a class="button button-outline" href="/solicitar-demo/?origen=seo">Solicitar demo ↗</a></div></div><div class="seo-diagram" aria-label="Ejemplo ilustrativo del proceso comercial"><span class="seo-diagram-meta">ANÁLISIS COMERCIAL · VISTA GLOBAL</span>'+
 ['Ventas y artículos|Evolución y referencias|↗','Compras y proveedores|Costes y oportunidades|⇄','Stock y rentabilidad|Cobertura y márgenes|◎'].map((item,i)=>{const parts=item.split("|");return (i?'<div class="seo-diagram-link" aria-hidden="true"></div>':'')+'<div class="seo-diagram-top"><span class="seo-diagram-icon">'+parts[2]+'</span><div><strong>'+parts[0]+'</strong><small>'+parts[1]+'</small></div><span>0'+(i+1)+'</span></div>';}).join('')+
 '<span class="seo-diagram-caption">Una mirada a tu negocio</span></div></div></div></section>';
}
function render(p){
 const crumbs=[{name:"Inicio",href:"/"},{name:p.type==="article"?"Blog":p.type==="integration"?"Integraciones":"Soluciones",href:"/"+typePath(p.type)+"/"},{name:p.title,href:p.url}];
 const breadcrumbLd=jsonld({"@context":"https://schema.org","@type":"BreadcrumbList",itemListElement:crumbs.map((b,i)=>({"@type":"ListItem",position:i+1,name:b.name,item:b.href}))});
 const faqLd=p.faq?.length?jsonld({"@context":"https://schema.org","@type":"FAQPage",mainEntity:p.faq.map(([q,a])=>({"@type":"Question",name:q,acceptedAnswer:{"@type":"Answer",text:a}}))}):"";
 const articleLd=p.type==="article"?jsonld({"@context":"https://schema.org","@type":"BlogPosting",headline:p.title,description:p.description,datePublished:"2026-10-17",dateModified:"2026-10-17",author:{"@type":"Organization",name:"Equipo Farmetrica"},publisher:{"@type":"Organization",name:"Farmetrica"},inLanguage:"es-ES"}):"";
 const sections=p.sections.map((s,i)=>'<section class="seo-detail-section" aria-labelledby="sech-'+i+'"><div class="seo-section-number">'+String(i+1).padStart(2,"0")+'</div><div><h2 id="sech-'+i+'">'+esc(s.heading)+'</h2>'+s.paragraphs.map(t=>'<p>'+esc(t)+'</p>').join('')+(s.points?.length?'<ul class="seo-checklist">'+s.points.map(t=>'<li>'+esc(t)+'</li>').join('')+'</ul>':"")+'</div></section>').join('');
 const related=(p.related||[]).map(x=>byUrl.get(x)).filter(Boolean);
 const statusNote=p.type==="integration"?(p.slug==="farmatic"?"Ventas conectadas con Farmatic":"Tu programa, una visión de negocio"):"Lo que puedes analizar";
 const pendingDataModules=new Set(["software-analitica-farmacias","comparar-farmacias-red","analisis-compras-farmacia","rentabilidad-farmacia","control-stock-farmacia","reposicion-stock-farmacia","analisis-proveedores-farmacia","comparativa-genericos-farmacia","rendimiento-articulos-farmacia","business-intelligence-farmacias"]);
 const dataNotice=p.type==="solution"&&pendingDataModules.has(p.slug)
  ? "Los indicadores se muestran según la información habilitada para cada farmacia."
  :p.type==="solution"&&["gestion-promociones-farmacia","grupos-de-farmacias","objetivos-venta-farmacias"].includes(p.slug)
  ? "El seguimiento de campañas utiliza los datos de ventas disponibles en el entorno conectado."
  :null;
 const faq=p.faq?.length?'<section class="seo-faq" aria-labelledby="faq-title"><div class="container"><div class="seo-title-row"><span class="section-label">Preguntas frecuentes</span><h2 id="faq-title">Lo que conviene tener claro</h2></div><div class="seo-faq-list">'+p.faq.map(([q,a])=>'<details><summary>'+esc(q)+'</summary><p>'+esc(a)+'</p></details>').join('')+'</div></div></section>':"";
 return head(p.title,p.description,p.url,p.type,breadcrumbLd+faqLd+articleLd)+'<main id="contenido">'+hero(p,crumbs)+'<section class="seo-content" id="detalle"><div class="container"><div class="seo-detail-grid"><div class="seo-main-copy">'+(p.type==="article"?'<div class="article-meta"><span>Equipo Farmetrica</span> · <time datetime="2026-10-17">17 de octubre de 2026</time></div>':'')+'<h2 class="seo-intro-title">'+esc(p.title)+'</h2><p class="seo-intro">'+esc(p.lead)+'</p>'+sections+'</div><aside class="seo-aside"><div class="seo-status"><strong>'+esc(statusNote)+'</strong><p>'+esc(p.value)+'</p>'+(dataNotice?'<p class="seo-data-notice">'+esc(dataNotice)+'</p>':'')+'</div><div class="seo-aside-links"><h3>Explora más</h3><a href="/soluciones/">Todas las soluciones ↗</a><a href="/integraciones/">Integraciones ↗</a><a href="/blog/">Blog de farmacia ↗</a></div></aside></div></div></section>'+faq+'<section class="seo-related"><div class="container"><div class="seo-title-row"><span class="section-label">También te puede interesar</span><h2>Continúa explorando Farmetrica</h2></div>'+cards(related)+'</div></section><section class="seo-cta-section"><div class="container">'+cta+'</div></section></main>'+footer+'</body></html>';
}
function hub(kind){
 const solution=kind==="solution",path=solution?"/soluciones/":"/integraciones/";
 const items=(solution?[
 "software-analitica-farmacias","ventas-farmacia","analisis-compras-farmacia","control-stock-farmacia","rentabilidad-farmacia",
 "analisis-proveedores-farmacia","reposicion-stock-farmacia","rendimiento-articulos-farmacia",
 "cuadro-mando-farmacias","grupos-de-farmacias","comparar-farmacias-red","business-intelligence-farmacias",
 "comparativa-genericos-farmacia","gestion-usuarios-farmacias","seguimiento-ventas-farmacia",
 "gestion-promociones-farmacia","objetivos-venta-farmacias","importar-campanas-excel","reporting-laboratorios"
].map(slug=>solutions.find(p=>p.slug===slug)).filter(Boolean):integrations).map(item=>({...item,url:path+item.slug+"/"}));
 const title=solution?"Soluciones de inteligencia de negocio para farmacias":"Sistemas de gestión e integraciones de farmacia";
 const description=solution?"Descubre las áreas de inteligencia de negocio de Farmetrica: ventas, compras, rentabilidad, stock, artículos, reposición, proveedores y gestión de redes.":"Explora cómo Farmetrica complementa Farmatic, Unycop, Nixfarma y otros programas de farmacia con inteligencia de negocio.";
 const intro=solution?"Cada decisión merece una perspectiva diferente. Relaciona ventas, compras, existencias, rentabilidad y rendimiento de artículos para tomar decisiones con una visión del negocio, tanto en una farmacia como en una red.":"Tu programa gestiona el día a día. Farmetrica aporta una visión comercial transversal para analizar ventas, compras, márgenes, stock y proveedores. Conoce las opciones de conexión para tu sistema.";
 const proof=solution?["Analizar las ventas","Mejorar compras y márgenes","Controlar stock y reposición","Comparar farmacias y proveedores"]:["Farmatic / Consoft","Nixfarma","Unycop","Bitfarma y Farmanager"];
 const note=solution?"Las capacidades de análisis se ajustan a la información disponible en el origen. Farmetrica complementa el programa de gestión de cada farmacia.":"Farmatic dispone de una conexión de ventas implantada. Las opciones para otros programas dependen de su versión, permisos y configuración; no se anuncian como conectores ya operativos. Las marcas pertenecen a sus titulares.";
 return head(title,description,path,"website")+'<main id="contenido"><section class="seo-hero seo-hub-hero"><div class="container"><nav class="breadcrumb seo-crumb"><a href="/">Inicio</a> / <span>'+(solution?"Soluciones":"Integraciones")+'</span></nav><div class="seo-hub-heading"><span class="seo-kicker"><span class="seo-kicker-dot"></span>'+(solution?"Un producto, diferentes necesidades":"Conecta tu información")+'</span><h1>'+esc(title)+'</h1><p>'+esc(intro)+'</p><div class="hero-actions"><a class="button button-mint" href="#catalogo">Explorar funcionalidades ↓</a><a class="button button-outline" href="/solicitar-demo/?origen=seo">Solicitar demo ↗</a></div></div></div></section><section class="seo-hub-body" id="catalogo"><div class="container"><div class="seo-title-row"><span class="section-label">Explora cada apartado</span><h2>'+(solution?"Encuentra la solución para tu necesidad":"Explora tu programa de gestión")+'</h2></div>'+cards(items)+'<div class="seo-proof-grid">'+proof.map((x,i)=>'<div><strong>'+String(i+1).padStart(2,"0")+'</strong><span>'+esc(x)+'</span></div>').join('')+'</div><p class="seo-hub-note">'+esc(note)+'</p></div></section><section class="seo-cta-section"><div class="container">'+cta+'</div></section></main>'+footer+'</body></html>';
}
for(const p of records){
 const output=join(root,p.url,"index.html");
 mkdirSync(join(root,p.url),{recursive:true});
 writeFileSync(output,render(p),"utf8");
}
for(const [p,t] of [["soluciones","solution"],["integraciones","integration"]]){
 mkdirSync(join(root,p),{recursive:true});
 writeFileSync(join(root,p,"index.html"),hub(t),"utf8");
}
console.log("Generadas "+records.length+" páginas editoriales y 2 páginas índice");

// Sitemap SEO de fuente única: descubrir las páginas HTML reales que se publican.
// Las fichas generadas y los artículos escritos manualmente se recogen sin mantener
// un segundo listado a mano en Nginx. Las páginas noindex nunca se anuncian.
const sitemapOrigin="__FARMETRICA_SITE_ORIGIN__";
const sitemapPaths=new Set(["/"]); // La portada se sirve desde landing.html.
const seoPrefixes=["/soluciones/","/integraciones/","/blog/","/solicitar-demo/","/privacidad/"];
function scanIndexablePages(directory){
 for(const entry of readdirSync(directory,{withFileTypes:true})){
  const file=join(directory,entry.name);
  if(entry.isDirectory()){scanIndexablePages(file);continue;}
  if(!entry.isFile()||entry.name!=="index.html")continue;
  const route="/"+relative(root,dirname(file)).replaceAll("\\","/")+"/";
  if(!seoPrefixes.some(prefix=>route.startsWith(prefix)))continue;
  const html=readFileSync(file,"utf8");
  const robots=html.match(/<meta\b[^>]*name=["']robots["'][^>]*>/i)?.[0]||"";
  if(/content=["'][^"']*\bnoindex\b/i.test(robots))continue;
  sitemapPaths.add(route);
 }
}
scanIndexablePages(root);
const sitemapRoutes=[...sitemapPaths].sort((a,b)=>a==="/"?-1:b==="/"?1:a.localeCompare(b,"es"));
const sitemap='<?xml version="1.0" encoding="UTF-8"?>\n'
 +'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
 +sitemapRoutes.map(route=>'  <url><loc>'+sitemapOrigin+esc(route)+'</loc></url>').join("\n")
 +'\n</urlset>\n';
writeFileSync(join(root,"sitemap.xml"),sitemap,"utf8");
console.log("Sitemap generado: "+sitemapRoutes.length+" rutas indexables");
