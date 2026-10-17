import {solutions,integrations,articles} from "./seo-content.mjs";
import {readFileSync} from "node:fs";
import assert from "node:assert/strict";

const read=path=>readFileSync(new URL(path,import.meta.url),"utf8");
const home=read("./public/landing.html");
const blog=read("./public/blog/index.html");
const login=read("./login.html");
const nginx=read("./nginx.conf");
const css=read("./public/marketing.css");
const posts=[
  "presentamos-farmetrica",
  "objetivos-por-farmacia",
  "datos-reales-integraciones",
];
for(const [name,html] of [["landing",home],["blog",blog]]){
  assert.match(html,/<html lang="es">/);
  assert.match(html,/<meta name="description"/);
  assert.match(html,/<link rel="stylesheet" href="\/marketing.css">/);
  assert.match(html,/href="\/login"/);
  assert.doesNotMatch(html,/<script[^>]+src="\/assets\//);
}
assert.match(home,/<h1 id="hero-title">/);
assert.match(home,/Farmatic/);
assert.match(home,/Nixfarma/);
assert.match(home,/Unycop/);
assert.match(home,/Vista ilustrativa/);
assert.match(home,/Integración en estudio/);
assert.match(css,/@media\(max-width:700px\)/);
assert.match(login,/query\.get\("next"\) \|\| "\/promociones"/);
assert.match(login,/next === "\/" \? "\/promociones"/);
for(const slug of posts){
  const html=read("./public/blog/"+slug+"/index.html");
  assert.match(home,new RegExp('href="/blog/'+slug+'/?"'));
  assert.match(blog,new RegExp('href="/blog/'+slug+'/?"'));
  assert.match(html,/Equipo Farmetrica/);
  assert.match(html,/<article class="article-wrap">/);
  assert.match(html,/href="\/login"/);
  assert.ok(html.length>2300,slug+" debe contener un artículo completo");
}
assert.match(nginx,/location = \/ \{/);
assert.match(nginx,/try_files \/landing\.html =404;/);
assert.match(nginx,/location \^~ \/blog\/ \{/);
assert.match(nginx,/location = \/marketing\.css \{/);
assert.match(nginx,/location = \/login \{/);
assert.match(nginx,/location = \/landing\.html \{ return 404; \}/);
assert.match(nginx,/location \/ \{\s*auth_request \/__authcheck;/);
assert.match(nginx,/error_page 401 = @login_redirect;/);

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
    assert.match(html,/Integración: (operativa|en estudio)/);
    if(p.slug!=="farmatic")assert.match(html,/Integración: en estudio/);
  }
  for(const related of p.related||[])assert.ok(allUrls.has(related),"Enlace contextual desconocido: "+related);
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
assert.match(nginx,/location = \/sitemap\.xml \{/);
assert.match(nginx,/location \^~ \/soluciones\/ \{/);
assert.match(nginx,/location \^~ \/integraciones\/ \{/);
assert.match(nginx,/Sitemap: \$public_scheme:\/\/\$host\/sitemap\.xml/);
assert.match(nginx,/location \/ \{\s*auth_request \/__authcheck;/);

console.log("Marketing público y panel privado: estructura y navegación verificadas");
