import test from "node:test";
import assert from "node:assert/strict";
import {classifyAbcd,applyAbcd} from "./abcd.js";

test("ABCD usa contribución acumulada con ventanas 80/95 y D sin ventas",()=>{
 const values=[80,10,5,3,2,0];
 const rows=values.map((value,i)=>({pharmacyId:"1",cn:String(i+1),value,units:value>0?1:0}));
 const classes=classifyAbcd(rows,{scope:r=>r.pharmacyId});
 assert.deepEqual(rows.map(r=>classes.get(r.pharmacyId+"|"+r.cn)),["A","B","B","C","C","D"]);
 assert.equal(classes.get("1|6"),"D");
});
test("ABCD no mezcla farmacias y soporta unidades vendidas con ingreso cero",()=>{
 const rows=[{pharmacyId:"1",cn:"X",value:100,units:10},
  {pharmacyId:"1",cn:"Y",value:0,units:2},
  {pharmacyId:"2",cn:"X",value:0,units:0},
  {pharmacyId:"2",cn:"Z",value:8,units:1}];
 const classes=classifyAbcd(rows,{scope:r=>r.pharmacyId});
 assert.equal(classes.get("1|X"),"A");
 assert.equal(classes.get("1|Y"),"C");
 assert.equal(classes.get("2|X"),"D");
 assert.equal(classes.get("2|Z"),"A");
 assert.deepEqual(applyAbcd([{pharmacyId:"1",cn:"N"}],classes)[0].abcdClass,"D");
 assert.equal(applyAbcd([{pharmacyId:"1",cn:"N"}],classes,{available:false})[0].abcdClass,null);
});
test("ABCD por genérico acumula líneas de presentaciones equivalentes",()=>{
 const rows=[{dcpf:"1",cn:"A",revenue:35,salesUnits:4},
  {dcpf:"1",cn:"B",revenue:45,salesUnits:5},
  {dcpf:"2",cn:"C",revenue:20,salesUnits:3},
  {dcpf:"3",cn:"D",revenue:0,salesUnits:0}];
 const map=classifyAbcd(rows,{identity:r=>r.dcpf,revenue:r=>r.revenue,units:r=>r.salesUnits});
 assert.equal(map.get("_all|1"),"A");
 assert.equal(map.get("_all|2"),"B");
 assert.equal(map.get("_all|3"),"D");
});
