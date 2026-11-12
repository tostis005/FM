import test from "node:test";
import assert from "node:assert/strict";
import {HEAT_STOPS,heatColor,heatmapHours,mergeSalesHeatmap} from "./salesHeatmap.js";

test("los extremos cromáticos distinguen poco movimiento del pico rojo",()=>{
 assert.equal(heatColor(0),HEAT_STOPS[0]);
 assert.equal(heatColor(1),HEAT_STOPS.at(-1));
 assert.equal(heatColor(-5),HEAT_STOPS[0]);
 assert.equal(heatColor(7),HEAT_STOPS.at(-1));
 assert.notEqual(heatColor(0.4),heatColor(0.8));
});
test("las celdas suman tickets, no las líneas, entre ventanas históricas",()=>{
 const result=mergeSalesHeatmap([
  {total:5,cells:[{weekday:1,hour:9,tickets:2},{weekday:2,hour:10,tickets:3}]},
  {total:9,cells:[{weekday:1,hour:9,tickets:4},{weekday:7,hour:21,tickets:5}]}
 ]);
 assert.equal(result.total,14);
 assert.deepEqual(result.cells,[
  {weekday:1,hour:9,tickets:6},
  {weekday:2,hour:10,tickets:3},
  {weekday:7,hour:21,tickets:5}
 ]);
});
test("el mapa muestra las horas de jornada y también actividad nocturna",()=>{
 const rows=heatmapHours([{weekday:1,hour:7,tickets:1},
  {weekday:2,hour:23,tickets:3}]);
 assert.deepEqual(rows.map(x=>x.hour),[7,...Array.from({length:13},(_,i)=>9+i),23]);
 assert.equal(rows.find(x=>x.hour===21).label,"21:00–22:00");
 assert.equal(rows.at(-1).label,"23:00–00:00");
 assert.equal(heatmapHours([]).length,13);
});
