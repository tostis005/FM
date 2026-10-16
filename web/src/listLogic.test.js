import test from "node:test";
import assert from "node:assert/strict";
import {filterSortRows,pageRows} from "./listLogic.js";

const rows=[
 {id:"a",name:"Ácido hialurónico",goal:20,status:"Activa",cn:"001474"},
 {id:"b",name:"Gel",goal:2,status:"Borrador",cn:"164432"},
 {id:"c",name:"Gel 10",goal:100,status:"Activa",cn:"000001"},
 {id:"d",name:"Gel 2",goal:20,status:"Finalizada",cn:"000003"},
];
const columns=[
 {key:"name",value:r=>r.name},{key:"goal",value:r=>r.goal},
 {key:"status",value:r=>r.status},{key:"cn",value:r=>r.cn},
];
test("filtros por cabecera combinados, ignoran mayúsculas y tildes",()=>{
 const list=filterSortRows(rows,columns,{name:"ACIDO"});
 assert.deepEqual(list.map(x=>x.id),["a"]);
 assert.deepEqual(filterSortRows(rows,columns,{name:"gel",status:"activa"}).map(x=>x.id),["c"]);
 assert.equal(filterSortRows(rows,columns,{cn:"000001"}).length,1);
 assert.equal(filterSortRows(rows,columns,{goal:"0"}).length,3);
});
test("ordenación numérica, natural y estable",()=>{
 assert.deepEqual(filterSortRows(rows,columns,{}, {key:"goal",direction:"desc"}).map(x=>x.id),["c","a","d","b"]);
 assert.deepEqual(filterSortRows(rows,columns,{name:"gel"},{key:"name",direction:"asc"}).map(x=>x.id),["b","d","c"]);
 assert.deepEqual(filterSortRows(rows,columns,{}, {key:"goal",direction:"asc"}).map(x=>x.id),["b","a","d","c"]);
 assert.deepEqual(filterSortRows(rows,columns,{}, {key:"invalid",direction:"desc"}),rows);
});
test("paginación configurable sin repetir ni perder filas",()=>{
 const list=Array.from({length:107},(_,id)=>id);
 for(const size of [10,25,50,100]){
  const pages=Math.ceil(list.length/size);
  const seen=[];
  for(let page=0;page<pages;page++) seen.push(...pageRows(list,page,size).items);
  assert.deepEqual(seen,list);
  assert.equal(pageRows(list,999,size).page,pages-1);
  assert.equal(pageRows(list,999,size).items.at(-1),106);
 }
 assert.deepEqual(pageRows([],3,10),{page:0,items:[]});
});

test("desplegables multivalor: O dentro de columna, Y entre columnas, coincidencia exacta",()=>{
 const campaignRows=[
  {id:"1",name:"GUM",status:"Activa",cns:["000001","000002"],pharmacies:["1","3"]},
  {id:"2",name:"VITIS",status:"Activa",cns:["000003"],pharmacies:["2"]},
  {id:"3",name:"NUXE",status:"Borrador",cns:["000001"],pharmacies:["2","4"]},
 ];
 const columns=[
  {key:"name",value:p=>p.name},
  {key:"status",value:p=>p.status},
  {key:"cns",value:p=>p.cns.length,filterValues:p=>p.cns},
  {key:"pharmacies",value:p=>p.pharmacies.length,filterValues:p=>p.pharmacies},
 ];
 assert.deepEqual(filterSortRows(campaignRows,columns,{pharmacies:["1","2"]}).map(p=>p.id),["1","2","3"]);
 assert.deepEqual(filterSortRows(campaignRows,columns,{pharmacies:["1","2"],cns:["000001"]}).map(p=>p.id),["1","3"]);
 assert.deepEqual(filterSortRows(campaignRows,columns,{pharmacies:["2"],cns:["000001"],status:["Activa"]}).map(p=>p.id),[]);
 assert.deepEqual(filterSortRows(campaignRows,columns,{cns:["00000"]}).map(p=>p.id),[]);
 assert.equal(filterSortRows(campaignRows,columns,{pharmacies:[],status:[]}).length,3);
});
