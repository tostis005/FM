import test from "node:test";
import assert from "node:assert/strict";
import {pickingListChannelView,pickingListRowsForSite} from "./pickingListChannelView.js";

const report={
 channels:["web","app"],totals:{units:8,lines:3},channelTotals:{
  web:{orders:2,units:6,lines:2,allocated:6,pending:0},
  app:{orders:1,units:2,lines:1,allocated:2,pending:0}
 },
 rows:[
  {key:"CN1",required:5,stock:[{id:"6",code:"ALMACEN",displayCode:"ALM",stock:10,planned:5}],
   channelSlices:{
    web:{required:3,planned:[3],details:[{orderName:"#A"}],status:"cubierto",lines:1},
    app:{required:2,planned:[2],details:[{orderName:"#B"}],status:"cubierto",lines:1}
   }},
  {key:"CN2",required:3,stock:[{id:"6",code:"ALMACEN",displayCode:"ALM",stock:10,planned:3}],
   channelSlices:{web:{required:3,planned:[3],details:[{orderName:"#C"}],status:"cubierto",lines:1}}}
 ]
};

test("Seleccionar un canal conserva su propuesta, pedidos y códigos visibles",()=>{
 const app=pickingListChannelView(report,"app");
 assert.deepEqual(app.rows.map(r=>r.key),["CN1"]);
 assert.equal(app.totals.units,2);
 assert.equal(app.rows[0].required,2);
 assert.equal(app.rows[0].stock[0].planned,2);
 assert.equal(app.rows[0].stock[0].code,"ALMACEN");
 assert.equal(app.rows[0].stock[0].displayCode,"ALM");
 assert.equal(app.rows[0].details[0].orderName,"#B");
 assert.equal(report.rows[0].stock[0].planned,5,"No muta el informe original");
 assert.equal(pickingListChannelView(report,""),report);
});

test("Si un canal desaparece, no se mezclan datos de otros canales",()=>{
 const unknown=pickingListChannelView(report,"missing");
 assert.deepEqual(unknown.rows,[]);
 assert.equal(unknown.totals.units,0);
});

test("La vista de cada farmacia solo incluye referencias con unidades para recoger",()=>{
 const rows=[
  {key:"A",stock:[{id:"6",stock:10,planned:3},{id:"1",stock:7,planned:2}]},
  {key:"B",stock:[{id:"6",stock:6,planned:4},{id:"1",stock:8,planned:0}]},
  {key:"C",stock:[{id:"6",stock:4,planned:0},{id:"1",stock:10,planned:1}]},
  {key:"D",stock:[{id:"6",stock:5,planned:0},{id:"1",stock:9,planned:0}]}
 ];
 assert.deepEqual(pickingListRowsForSite(rows,"1").map(r=>r.key),["A","C"]);
 assert.deepEqual(pickingListRowsForSite(rows,6).map(r=>r.key),["A","B"]);
 assert.deepEqual(pickingListRowsForSite(rows,"nueva"),[]);
 assert.equal(pickingListRowsForSite(rows,undefined),rows);
 assert.deepEqual(rows[1].stock[1].planned,0,"La selección no modifica asignaciones");
});

test("Filtra según las unidades del canal seleccionado, no las del total general",()=>{
 const source={rows:[
  {key:"A",stock:[{id:"1",planned:2},{id:"6",planned:0}],channelSlices:{
   web:{required:2,planned:[0,2]},app:{required:1,planned:[1,0]}
  }},
  {key:"B",stock:[{id:"1",planned:1},{id:"6",planned:0}],channelSlices:{
   web:{required:1,planned:[1,0]}
  }}
 ]};
 const web=pickingListChannelView(source,"web");
 assert.deepEqual(pickingListRowsForSite(web.rows,"1").map(r=>r.key),["B"]);
 assert.deepEqual(pickingListRowsForSite(web.rows,"6").map(r=>r.key),["A"]);
 const app=pickingListChannelView(source,"app");
 assert.deepEqual(pickingListRowsForSite(app.rows,"1").map(r=>r.key),["A"]);
 assert.deepEqual(pickingListRowsForSite(app.rows,"6"),[]);
});
