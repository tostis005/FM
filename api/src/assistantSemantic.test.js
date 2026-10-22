import test from 'node:test';
import assert from 'node:assert/strict';
import {semanticPlannerPrompt,parseSemanticPlans} from './assistantSemantic.js';
const context={role:'gestor',client:{schema:'ampedia'},modules:{ventas:true,compras:true},allowedPharmacyIds:[1],pharmacies:[{id:1,name:'Abadía'}]};
test('plans for available sales metrics',()=>{
 const plan={consultas:[{fuente:'ventas',agrupar:['farmacia','vendedor'],metricas:['importe'],periodo:'hoy'}]};
 assert.deepEqual(parseSemanticPlans(JSON.stringify(plan),context),plan.consultas);
 assert.match(semanticPlannerPrompt(context),/MCP/);
});
