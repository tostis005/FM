import test from "node:test";
import assert from "node:assert/strict";
import {pickingListChannelView} from "./pickingListChannelView.js";

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
