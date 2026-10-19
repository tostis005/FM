import assert from "node:assert/strict";
import {test} from "node:test";
import {normalizedLines,pendingUnits,canTransition,csvForPlan} from "./operativaRules.js";
const need={id:"x",articulo:"123456",nombre:"Producto",necesidad:20,
 asignaciones:[{proveedor:"A",unidades:20,coste:2}]};
test("reasignar a cero no borra la necesidad",()=>{
 const item=normalizedLines([{...need,asignaciones:[{proveedor:"A",unidades:0,coste:2}]}])[0];
 assert.equal(item.necesidad,20);assert.equal(pendingUnits(item),20);
});
test("repartir parcialmente conserva pendientes",()=>{
 const item=normalizedLines([{...need,asignaciones:[
  {proveedor:"A",unidades:8,coste:2},{proveedor:"B",unidades:5,coste:3}]}])[0];
 assert.equal(pendingUnits(item),7);
});
test("rechazar sobreasignación y valores erróneos",()=>{
 assert.throws(()=>normalizedLines([{...need,asignaciones:[{proveedor:"A",unidades:21,coste:2}]}]));
 assert.throws(()=>normalizedLines([{...need,necesidad:2.5,asignaciones:[]}]));
 assert.throws(()=>normalizedLines([{...need,asignaciones:[{proveedor:"A",unidades:2,coste:-3}]}]));
});
test("no permitir reabrir oportunidades cerradas ni editar pedidos aprobados",()=>{
 assert.equal(canTransition("oportunidades","aplicada","en_curso"),false);
 assert.equal(canTransition("pedidos","aprobado","aprobado"),false);
 assert.equal(canTransition("pedidos","pendiente_aprobacion","pendiente_aprobacion"),true);
 assert.equal(canTransition("traspasos","propuesta","realizada"),false);
});
test("CSV neutraliza fórmulas",()=>{
 const csv=csvForPlan([{...need,nombre:"=42",asignaciones:[{proveedor:"A",unidades:4,coste:null}]}]);
 assert.match(csv,/'=42/);assert.match(csv,/16/);
});
