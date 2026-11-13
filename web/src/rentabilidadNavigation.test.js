import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const main=readFileSync(new URL("./main.jsx",import.meta.url),"utf8");
const screen=readFileSync(new URL("./RentabilidadProductos.jsx",import.meta.url),"utf8");
test("Rentabilidad es una entrada única del menú; antigua URL se redirige",()=>{
 const nav=main.slice(main.indexOf("const NAV=["),main.indexOf("function AppBreadcrumbs"));
 assert.equal((nav.match(/id:"rentabilidad"/g)||[]).length,1);
 assert.equal((nav.match(/id:"rentabilidad-productos"/g)||[]).length,0);
 assert.match(main,/if\(path==="rentabilidad-productos"\)return "rentabilidad"/);
 assert.match(main,/page==="rentabilidad"&&<RentabilidadProductos/);
});
test("El informe reúne resumen, productos y detalle de ventas",()=>{
 for(const label of ["Resumen","Productos y categorías","Detalle de ventas"])
  assert.ok(screen.includes('label:"'+label+'"'),label);
 assert.match(screen,/Rentabilidad por farmacia/);
 assert.match(screen,/Detalle de rentabilidad por familia/);
 assert.match(screen,/Coste hist\. informado/);
});

test("Rentabilidad ofrece filtro de familia separado de búsqueda libre",()=>{
 assert.match(screen,/\/api\/analytics\/rentabilidad\/familias/);
 assert.match(screen,/aria-label="Filtrar por familia"/);
 assert.match(screen,/Todas las familias/);
 assert.match(screen,/params\.set\("familia",family\)/);
 assert.match(screen,/Buscar CN o producto/);
 assert.match(screen,/Coste unitario \(catálogo\)/);
 assert.match(screen,/Ventas con coste/);
 assert.doesNotMatch(screen,/label:"PMC"/);
});
