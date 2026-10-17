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
console.log("Marketing público y panel privado: estructura y navegación verificadas");
