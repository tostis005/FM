import {readFileSync} from "node:fs";
import assert from "node:assert/strict";

const read=(path)=>readFileSync(new URL(path,import.meta.url),"utf8");
const login=read("./login.html");
const theme=read("./src/loginTheme.css");
const app=read("./src/main.jsx");
const index=read("./index.html");
assert.match(app,/import "\.\/styles\.css";\s*import "\.\/loginTheme\.css";/,
  "El tema debe importarse después de los estilos existentes");
assert.match(app,/className="brand-mark" aria-hidden="true"><img className="fm-emblem"/,
  "La marca interior debe mostrar el nuevo icono vectorial");
assert.match(theme,/\.fm-emblem/,"El tema interior usa el logo de Farmetrica");
assert.match(login,/<img class="fm-emblem" src="\/brand-logo\.webp\?v=4"/,"El acceso usa el mismo logotipo");
assert.doesNotMatch(app,/✳/,"No se muestra el icono anterior en la aplicación");
for(const color of ["#102f28","#0e4739","#145947","#b7ecc9"]){
  assert.ok(login.includes(color),"Falta el color del login: "+color);
  assert.ok(theme.includes(color),"El tema interior debe reutilizar el color "+color);
}
for(const selector of [".sidebar",".topbar",".page-header",".card",".btn-primary",
  ".data-table",".smart-column-filter",".list-pagination",".drawer-top"]){
  assert.ok(theme.includes(selector),"Falta tratamiento de "+selector);
}
assert.match(theme,/@media\(max-width:790px\)/);
assert.match(theme,/@media\(max-width:560px\)/);
assert.match(theme,/prefers-reduced-motion/);
assert.match(theme,/\.topbar \.icon-btn\[aria-label="Cerrar sesión"\]/);
assert.match(index,/name="theme-color" content="#102f28"/);
assert.doesNotMatch(theme,/FARMAWAO|Farmétrica|FarmaWow/);
console.log("Identidad visual Farmetrica: paleta, navegación, diseño móvil y accesibilidad correctos.");
