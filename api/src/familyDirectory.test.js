import test from "node:test";
import assert from "node:assert/strict";
import {groupFamilyDirectory,selectFamilyDirectory} from "./familyDirectory.js";

function f(id,name,segment="SIN_DETERMINAR",extra={}){
 return {id:String(id),name,segment,referencePharmacy:null,
  referenceCode:null,customName:false,...extra};
}
test("un nombre equivalente se presenta una sola vez sin fusionar sus familias de medicación y parafarmacia",()=>{
 const source=[
  f(11,"HOMEOPATIA","MEDICACION",{referencePharmacy:"ABA",referenceCode:"10"}),
  f(12,"Homeopatía","PARAFARMACIA",{referencePharmacy:"ALMACEN",referenceCode:"20"}),
  f(13,"homeopatia","SIN_DETERMINAR"),
 ];
 const list=selectFamilyDirectory(source);
 assert.equal(list.groups.length,1);
 assert.equal(list.summary.maestros,1);
 assert.equal(list.summary.pendientes,0);
 assert.equal(list.summary.medicacion,1);
 assert.equal(list.summary.parafarmacia,1);
 assert.equal(list.groups[0].name,"Homeopatía");
 assert.deepEqual(list.groups[0].members.map(x=>x.id),["11","12","13"]);
 assert.deepEqual(list.groups[0].segments,["MEDICACION","PARAFARMACIA","SIN_DETERMINAR"]);
 assert.deepEqual(source.map(x=>x.segment),["MEDICACION","PARAFARMACIA","SIN_DETERMINAR"],
  "La agrupación es solo visual; no altera clasificaciones ni artículos");
});
test("orden español alfabético de principio a fin, sin separar primero segmentos",()=>{
 const list=groupFamilyDirectory([
  f(1,"Zarza","MEDICACION",{referencePharmacy:"ABA"}),
  f(2,"Ácidos","SIN_DETERMINAR"),
  f(3,"BEBE","PARAFARMACIA",{referencePharmacy:"ALMACEN"}),
  f(4,"cosmetica","MEDICACION",{referencePharmacy:"ABA"}),
  f(5,"Bebé","SIN_DETERMINAR"),
 ]);
 assert.deepEqual(list.map(x=>x.name),["Ácidos","Bebé","Cosmética","Zarza"]);
});
test("sin duplicados entre la pestaña maestra y la de pendientes",()=>{
 const rows=[
  f(1,"2022 - DERMOCOSMETICA","PARAFARMACIA",{referencePharmacy:"ALMACEN"}),
  f(2,"Dermocosmética","SIN_DETERMINAR"),
  f(3,"Genéricos","MEDICACION",{referencePharmacy:"ABA"}),
  f(4,"GENERICOS","SIN_DETERMINAR"),
  f(5,"Otros","SIN_DETERMINAR"),f(6,"OTROS","SIN_DETERMINAR")
 ];
 const main=selectFamilyDirectory(rows,{view:"maestro"});
 const pending=selectFamilyDirectory(rows,{view:"pendientes"});
 assert.deepEqual(main.groups.map(x=>x.name),["Dermocosmética","Genéricos"]);
 assert.deepEqual(pending.groups.map(x=>x.name),["Otros"]);
 assert.equal(pending.groups[0].members.length,2);
 assert.equal(main.summary.maestros,2);
 assert.equal(main.summary.pendientes,1);
});
test("la paginación se hace después de agrupar y nunca divide equivalencias en dos páginas",()=>{
 const rows=[];
 for(let i=0;i<35;i++){
  rows.push(f(i*2+1,"Categoría "+String(i).padStart(2,"0")));
  rows.push(f(i*2+2,"CATEGORIA "+String(i).padStart(2,"0")));
 }
 const first=selectFamilyDirectory(rows,{view:"pendientes",page:1,pageSize:30});
 const second=selectFamilyDirectory(rows,{view:"pendientes",page:2,pageSize:30});
 assert.equal(first.groups.length,30);
 assert.equal(second.groups.length,5);
 assert.equal(first.total,35);
 assert.equal(first.summary.pendientes,35);
 assert.ok(first.groups.every(g=>g.members.length===2));
 assert.ok(second.groups.every(g=>g.members.length===2));
 assert.ok(first.groups.every(a=>second.groups.every(b=>a.key!==b.key)));
});
test("buscar ignora tildes, mayúsculas y prefijos sin confundir ñ con n",()=>{
 const rows=[
  f(1,"Higiene y Cosmética Infantil","PARAFARMACIA",{referencePharmacy:"ALMACEN",referenceCode:"00011"}),
  f(2,"2022 - Higiene/Cosmetica Infanti","SIN_DETERMINAR"),
  f(3,"Año","MEDICACION",{referencePharmacy:"ABA"}),
  f(4,"Ano","MEDICACION",{referencePharmacy:"ABA"})
 ];
 assert.equal(selectFamilyDirectory(rows,{search:"cosmetica"}).groups.length,1);
 assert.equal(selectFamilyDirectory(rows,{search:"2022 - higiene"}).groups.length,1);
 assert.equal(selectFamilyDirectory(rows,{search:"00011"}).groups.length,1);
 const years=groupFamilyDirectory(rows).filter(x=>["Año","Ano"].includes(x.name));
 assert.equal(years.length,2);
});
