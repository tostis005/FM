import {mkdirSync,writeFileSync} from "node:fs";
import {join,resolve} from "node:path";
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
 {url:"/",title:"Conoce Farmetrica",category:"Inicio",description:"Análisis de ventas, compras, márgenes, stock, proveedores y promociones para farmacias."},
 {url:"/soluciones/",title:"Todas las soluciones de Farmetrica",category:"Soluciones",description:"Todas las soluciones de ventas, compras, stock, reposición, proveedores, genéricos, artículos, rentabilidad y promociones."},
 {url:"/integraciones/",title:"Programas de gestión e integraciones",category:"Integraciones",description:"Modelo de conexión a sistemas de farmacia, con origen Farmatic implantado y evaluación técnica por ERP."},
 {url:"/blog/",title:"Blog de Farmetrica",category:"Blog",description:"Consejos prácticos sobre compras, stock, rentabilidad, proveedores, ventas y promociones de farmacia."}
];
const byUrl=new Map([...records,...hubRecords].map(p=>[p.url,p]));
const nav='<header class="site-nav"><div class="container"><a class="logo" href="/" aria-label="Farmetrica, inicio"><span class="logo-symbol" aria-hidden="true"></span>Farmetrica</a><nav class="nav-links" aria-label="Navegación"><a href="/soluciones/">Soluciones</a><a href="/integraciones/">Integraciones</a><a href="/blog/">Blog</a></nav><div class="nav-actions"><a class="login-button" href="/login">Acceder</a><details class="mobile-nav"><summary aria-label="Abrir menú de navegación">☰</summary><nav class="mobile-links"><a href="/">Inicio</a><a href="/soluciones/">Soluciones</a><a href="/integraciones/">Integraciones</a><a href="/blog/">Blog</a></nav></details></div></div></header>';
const footer='<footer class="footer"><div class="container"><div class="footer-top"><a class="logo" href="/"><span class="logo-symbol" aria-hidden="true"></span>Farmetrica</a><nav class="footer-nav" aria-label="Pie de página"><a href="/soluciones/">Soluciones</a><a href="/integraciones/">Integraciones</a><a href="/blog/">Blog</a><a href="/login">Acceder</a></nav></div><div class="footer-small"><span>© 2026 Farmetrica · Inteligencia comercial para farmacias</span><span>Ventas, compras, stock y rentabilidad en contexto.</span></div></div></footer>';
const jsonld=value=>'<script type="application/ld+json">'+JSON.stringify(value).replace(/</g,"\\u003c")+'</script>';
function head(title,description,canonical,type,extra=""){
 return '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#102f28"><meta name="robots" content="index,follow,max-image-preview:large"><meta name="description" content="'+esc(description)+'"><title>'+esc(title)+' | Farmetrica</title><meta property="og:locale" content="es_ES"><meta property="og:site_name" content="Farmetrica"><meta property="og:type" content="'+(type==="article"?"article":"website")+'"><meta property="og:title" content="'+esc(title)+'"><meta property="og:description" content="'+esc(description)+'"><link rel="canonical" href="'+esc(canonical)+'"><link rel="icon" type="image/svg+xml" href="/favicon.svg?v=2"><link rel="stylesheet" href="/marketing.css">'+extra+'</head><body><a class="skip-link" href="#contenido">Saltar al contenido</a>'+nav;
}
function cards(items){
 return '<div class="seo-card-grid">'+items.map(p=>'<a class="seo-card" href="'+p.url+'"><span class="seo-card-eyebrow">'+esc(p.category)+'</span><h3>'+esc(p.title)+'</h3><p>'+esc(p.description)+'</p><span class="seo-card-link">Descubrir más <span aria-hidden="true">↗</span></span></a>').join("")+'</div>';
}
const cta='<div class="seo-cta"><div><span class="section-label">Farmetrica</span><h2>Una visión completa. Decisiones que importan.</h2><p>Analiza ventas, compras, stock, proveedores, márgenes y campañas desde un mismo lugar.</p></div><div class="seo-cta-buttons"><a class="button button-mint" href="/soluciones/">Explorar soluciones →</a><a class="button button-outline" href="/login">Acceder al panel →</a></div></div>';
function hero(p,crumbs){
 const crumbsHtml=crumbs.slice(0,-1).map(c=>'<a href="'+c.href+'">'+esc(c.name)+'</a>').join(' <span aria-hidden="true">/</span> ');
 return '<section class="seo-hero"><div class="container"><nav class="breadcrumb seo-crumb" aria-label="Ruta de navegación">'+crumbsHtml+' <span aria-hidden="true">/</span> <span aria-current="page">'+esc(p.category)+'</span></nav><div class="seo-hero-layout"><div><span class="seo-kicker"><span class="seo-kicker-dot"></span>'+esc(p.category)+'</span><h1>'+esc(p.hero)+'</h1><p>'+esc(p.lead)+'</p><div class="hero-actions"><a class="button button-mint" href="#detalle">'+(p.type==="article"?"Leer guía":"Conocer la solución")+' <span aria-hidden="true">↓</span></a><a class="button button-outline" href="/integraciones/">Ver integraciones →</a></div></div><div class="seo-diagram" aria-label="Ejemplo ilustrativo del proceso comercial"><span class="seo-diagram-meta">ANÁLISIS COMERCIAL · VISTA GLOBAL</span>'+
 ['Productos identificados|CNs, periodo y condiciones|⌗','Objetivos por farmacia|Metas de unidades individuales|◎','Seguimiento y resultados|Ventas de origen conectado|↗'].map((item,i)=>{const parts=item.split("|");return (i?'<div class="seo-diagram-link" aria-hidden="true"></div>':'')+'<div class="seo-diagram-top"><span class="seo-diagram-icon">'+parts[2]+'</span><div><strong>'+parts[0]+'</strong><small>'+parts[1]+'</small></div><span>0'+(i+1)+'</span></div>';}).join('')+
 '<span class="seo-diagram-caption">Una mirada a tu negocio</span></div></div></div></section>';
}
function render(p){
 const crumbs=[{name:"Inicio",href:"/"},{name:p.type==="article"?"Blog":p.type==="integration"?"Integraciones":"Soluciones",href:"/"+typePath(p.type)+"/"},{name:p.title,href:p.url}];
 const breadcrumbLd=jsonld({"@context":"https://schema.org","@type":"BreadcrumbList",itemListElement:crumbs.map((b,i)=>({"@type":"ListItem",position:i+1,name:b.name,item:b.href}))});
 const faqLd=p.faq?.length?jsonld({"@context":"https://schema.org","@type":"FAQPage",mainEntity:p.faq.map(([q,a])=>({"@type":"Question",name:q,acceptedAnswer:{"@type":"Answer",text:a}}))}):"";
 const articleLd=p.type==="article"?jsonld({"@context":"https://schema.org","@type":"BlogPosting",headline:p.title,description:p.description,datePublished:"2026-10-17",dateModified:"2026-10-17",author:{"@type":"Organization",name:"Equipo Farmetrica"},publisher:{"@type":"Organization",name:"Farmetrica"},inLanguage:"es-ES"}):"";
 const sections=p.sections.map((s,i)=>'<section class="seo-detail-section" aria-labelledby="sech-'+i+'"><div class="seo-section-number">'+String(i+1).padStart(2,"0")+'</div><div><h2 id="sech-'+i+'">'+esc(s.heading)+'</h2>'+s.paragraphs.map(t=>'<p>'+esc(t)+'</p>').join('')+(s.points?.length?'<ul class="seo-checklist">'+s.points.map(t=>'<li>'+esc(t)+'</li>').join('')+'</ul>':"")+'</div></section>').join('');
 const related=(p.related||[]).map(x=>byUrl.get(x)).filter(Boolean);
 const statusNote=p.type==="integration"?(p.slug==="farmatic"?"Origen Farmatic conectado":"Conexión sujeta a validación por instalación"):"Inteligencia de negocio";
 const faq=p.faq?.length?'<section class="seo-faq" aria-labelledby="faq-title"><div class="container"><div class="seo-title-row"><span class="section-label">Preguntas frecuentes</span><h2 id="faq-title">Lo que conviene tener claro</h2></div><div class="seo-faq-list">'+p.faq.map(([q,a])=>'<details><summary>'+esc(q)+'</summary><p>'+esc(a)+'</p></details>').join('')+'</div></div></section>':"";
 return head(p.title,p.description,p.url,p.type,breadcrumbLd+faqLd+articleLd)+'<main id="contenido">'+hero(p,crumbs)+'<section class="seo-content" id="detalle"><div class="container"><div class="seo-detail-grid"><div class="seo-main-copy">'+(p.type==="article"?'<div class="article-meta"><span>Equipo Farmetrica</span> · <time datetime="2026-10-17">17 de octubre de 2026</time></div>':'')+'<h2 class="seo-intro-title">'+esc(p.title)+'</h2><p class="seo-intro">'+esc(p.lead)+'</p>'+sections+'</div><aside class="seo-aside"><div class="seo-status"><strong>'+esc(statusNote)+'</strong><p>'+esc(p.value)+'</p></div><div class="seo-aside-links"><h3>Explora más</h3><a href="/soluciones/">Todas las soluciones ↗</a><a href="/integraciones/">Integraciones ↗</a><a href="/blog/">Blog de farmacia ↗</a></div></aside></div></div></section>'+faq+'<section class="seo-related"><div class="container"><div class="seo-title-row"><span class="section-label">También te puede interesar</span><h2>Continúa explorando Farmetrica</h2></div>'+cards(related)+'</div></section><section class="seo-cta-section"><div class="container">'+cta+'</div></section></main>'+footer+'</body></html>';
}
function hub(kind){
 const solution=kind==="solution",items=solution?solutions:integrations,path=solution?"/soluciones/":"/integraciones/";
 const title=solution?"Soluciones de inteligencia de negocio para farmacias":"Sistemas de gestión e integraciones de farmacia";
 const description=solution?"Explora Farmetrica: ventas, compras, rentabilidad, stock, proveedores, genéricos, reposición, artículos y promociones.":"Conoce cómo conecta Farmetrica datos de programas de gestión de farmacia y qué requiere cada instalación.";
 const intro=solution?"Cada decisión merece una perspectiva diferente. Reúne datos de ventas, compras, inventario, rentabilidad y actividad comercial para gestionar mejor tu farmacia o una red.":"Farmetrica aprovecha los datos del software que ya utilizas y los organiza en un modelo comercial común. Farmatic está conectado en una instalación; otros programas requieren validar la conexión de cada cliente.";
 const proof=solution?["Analizar las ventas","Comparar compras y márgenes","Controlar stock y reposición","Coordinar promociones y farmacias"]:["Farmatic / Consoft","Nixfarma","Unycop","Bitfarma y Farmanager"];
 const note=solution?"Las capacidades de análisis se ajustan a la información disponible en el origen. Farmetrica complementa el programa de gestión de cada farmacia.":"La conexión operativa verificada utiliza Farmatic en el entorno actual. La disponibilidad de otros conectores depende de la versión, los permisos y la implantación. Los nombres citados pertenecen a sus titulares.";
 return head(title,description,path,"website")+'<main id="contenido"><section class="seo-hero seo-hub-hero"><div class="container"><nav class="breadcrumb seo-crumb"><a href="/">Inicio</a> / <span>'+(solution?"Soluciones":"Integraciones")+'</span></nav><div class="seo-hub-heading"><span class="seo-kicker"><span class="seo-kicker-dot"></span>'+(solution?"Un producto, diferentes necesidades":"Conectividad responsable")+'</span><h1>'+esc(title)+'</h1><p>'+esc(intro)+'</p><div class="hero-actions"><a class="button button-mint" href="#catalogo">Explorar páginas ↓</a><a class="button button-outline" href="/login">Acceso clientes →</a></div></div></div></section><section class="seo-hub-body" id="catalogo"><div class="container"><div class="seo-title-row"><span class="section-label">Explora cada apartado</span><h2>'+(solution?"Encuentra la solución para tu necesidad":"Conoce el estado de cada conexión")+'</h2></div>'+cards(items)+'<div class="seo-proof-grid">'+proof.map((x,i)=>'<div><strong>'+String(i+1).padStart(2,"0")+'</strong><span>'+esc(x)+'</span></div>').join('')+'</div><p class="seo-hub-note">'+esc(note)+'</p></div></section><section class="seo-cta-section"><div class="container">'+cta+'</div></section></main>'+footer+'</body></html>';
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
