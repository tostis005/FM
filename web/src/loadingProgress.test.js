import test from "node:test";
import assert from "node:assert/strict";
import {taskPercent,combinedPercent,userLoadingText} from "./loadingProgress.js";
test("porcentaje de un histórico válido, sin revelar ventanas SQL",()=>{
 const scope="tenant|2026",progress={scope,done:22,total:26};
 assert.equal(taskPercent(progress,scope),84);
 assert.equal(userLoadingText(taskPercent(progress,scope)),"Cargando datos · 84 %");
 assert.doesNotMatch(userLoadingText(taskPercent(progress,scope)),/22|26|bloques|períodos/);
 assert.equal(taskPercent({scope,done:26,total:26},scope),99);
 assert.equal(taskPercent(null,scope),null);
 assert.equal(taskPercent(progress,"otro-tenant"),null);
 assert.equal(taskPercent({scope,done:3,total:0},scope),null);
 assert.equal(taskPercent({scope,done:-1,total:2},scope),0);
 assert.equal(taskPercent({scope,done:100,total:2},scope),99);
 assert.equal(taskPercent(null,scope,true),100);
});
test("porcentaje conjunto no presupone avance de compras sin conocer su tamaño",()=>{
 const sale={progress:{scope:"v",done:8,total:10},scope:"v",completed:false};
 const buy={progress:{scope:"c",done:5,total:10},scope:"c",completed:false};
 assert.equal(combinedPercent([sale,buy]),65);
 assert.equal(combinedPercent([{...sale,completed:true},buy]),75);
 assert.equal(combinedPercent([sale,{...buy,progress:null}]),null);
 assert.equal(userLoadingText(combinedPercent([sale,{...buy,progress:null}])),"Cargando datos…");
 assert.equal(combinedPercent([{...sale,completed:true},{...buy,completed:true}]),99);
});
