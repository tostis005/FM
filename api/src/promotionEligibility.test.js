import test from "node:test";
import assert from "node:assert/strict";
import {promotionBundle} from "./promotionEligibility.js";

test("requisitos de unidades por campaña para agregados SQL",()=>{
 assert.equal(promotionBundle({type:"dos_por_uno"}),2);
 assert.equal(promotionBundle({type:"tres_por_dos"}),3);
 assert.equal(promotionBundle({type:"otras_unidades",formula:"4+1"}),5);
 assert.equal(promotionBundle({type:"segunda_porcentaje",discountPercent:50}),2);
 assert.equal(promotionBundle({type:"segunda_importe",discountAmount:3}),2);
 assert.equal(promotionBundle({type:"descuento_porcentaje",discountPercent:20}),1);
 assert.equal(promotionBundle({type:"descuento_importe",discountAmount:3}),1);
 assert.equal(promotionBundle({type:"escalonado",formula:"20% POR 1 UD y 30% 2 UDS O MAS"}),1);
 assert.equal(promotionBundle({type:"sin_clasificar"}),null);
 assert.equal(promotionBundle({type:"regalo",formula:"regalo por compra"}),null);
});
