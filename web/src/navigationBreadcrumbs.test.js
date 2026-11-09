import test from "node:test";
import assert from "node:assert/strict";
import {navigationBreadcrumbs} from "./navigationBreadcrumbs.js";
const items=[
 {id:"dashboard",label:"Inicio"},
 {id:"promociones",label:"Promociones"},
 {id:"promociones-objetivos",label:"Nueva campaña",childOf:"promociones"},
 {id:"compras",label:"Compras"},
 {id:"compras-preparador",label:"Preparador de pedidos",childOf:"compras"},
 {id:"farmacias",label:"Farmacias"},
 {id:"proveedores",label:"Proveedores"}
];
test("seguimiento: origen navegable solo cuando tiene permiso",()=>{
 const granted=id=>["dashboard","promociones","seguimiento-global"].includes(id);
 const trail=navigationBreadcrumbs("seguimiento-global",items,granted);
 assert.deepEqual(trail.map(x=>x.label),["Inicio","Promociones","Seguimiento"]);
 assert.deepEqual(trail.map(x=>x.link),[true,true,false]);
 const restricted=navigationBreadcrumbs("seguimiento-global",items,id=>id==="seguimiento-global");
 assert.deepEqual(restricted.map(x=>x.label),["Promociones","Seguimiento"]);
 assert.deepEqual(restricted.map(x=>x.link),[false,false]);
});
test("secciones y subpáginas muestran padres correctos sin enlaces indebidos",()=>{
 const granted=id=>id==="compras-preparador"||id==="dashboard";
 const trail=navigationBreadcrumbs("compras-preparador",items,granted);
 assert.deepEqual(trail.map(x=>x.label),["Inicio","Compras","Preparador de pedidos"]);
 assert.deepEqual(trail.map(x=>x.link),[true,false,false]);
 const settings=navigationBreadcrumbs("farmacias",items,id=>id==="dashboard");
 assert.deepEqual(settings.map(x=>x.label),["Inicio","Configuración","Farmacias"]);
 assert.deepEqual(settings.map(x=>x.link),[true,false,false]);
});
test("no inventar enlace de inicio para perfiles sin dashboard",()=>{
 assert.deepEqual(navigationBreadcrumbs("proveedores",items,id=>id==="proveedores")
  .map(x=>x.label),["Proveedores"]);
 assert.deepEqual(navigationBreadcrumbs("dashboard",items,()=>true),[
  {id:"dashboard",label:"Inicio",current:true,link:false}
 ]);
});
test("editar objetivos distingue la página del modo alta",()=>{
 const b=navigationBreadcrumbs("promociones-objetivos",items,()=>false,{editingObjectives:true});
 assert.deepEqual(b.map(x=>x.label),["Promociones","Editar objetivos"]);
 assert.deepEqual(b.map(x=>x.link),[false,false]);
});
