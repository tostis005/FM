import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import assert from "node:assert/strict";

const page = readFileSync(new URL("./login.html", import.meta.url), "utf8");
const script = page.match(/<script>([\s\S]*?)<\/script>/i)?.[1];
assert.ok(script, "La página de login debe tener el controlador de acceso");
new Script(script, { filename: "login.html:inline" });
assert.match(page, /type="password"/);
assert.match(script, /\/api\/auth\/local/);
assert.doesNotMatch(page, /TEMP_ADMIN_PASSWORD_HASH|SESSION_SECRET/);
const indexPage=readFileSync(new URL("./index.html", import.meta.url),"utf8");
const appSource=readFileSync(new URL("./src/main.jsx", import.meta.url),"utf8");
for(const [name,source] of [["login",page],["index",indexPage],["app",appSource]]){
  assert.doesNotMatch(source,/FARMAWAO|FarmaWow|FarmaWao|Farmétrica/,name+" no debe contener marcas anteriores o tildes");
  assert.match(source,/Farmetrica/,name+" debe identificar la marca Farmetrica");
}
assert.match(page,/Acceder a Farmetrica/);

console.log("Login HTML y JavaScript: sintaxis y controles básicos correctos");
