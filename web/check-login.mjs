import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import assert from "node:assert/strict";

const page = readFileSync(new URL("./login.html", import.meta.url), "utf8");
const script = page.match(/<script>([\s\S]*?)<\/script>/i)?.[1];
assert.ok(script, "La página de login debe tener el controlador de acceso");
new Script(script, { filename: "login.html:inline" });
assert.match(page, /type="password"/);
assert.match(script, /\/api\/auth\/local/);
assert.doesNotMatch(page, /TEMP_ADMIN_PASSWORD_HASH|SESSION_SECRET|123456@\$/);
console.log("Login HTML y JavaScript: sintaxis y controles básicos correctos");
