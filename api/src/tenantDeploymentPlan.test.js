import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareDemoPharmacyMapping,validateDemoActivation} from './tenantDeploymentPlan.js';
const pharmacies=[
 {id:1,sourceCode:'AAA',active:true},
 {id:2,sourceCode:'BBB',active:true},
 {id:3,sourceCode:'CCC',active:false},
 {id:4,sourceCode:'ALM',active:true,establishmentType:'almacen'}
];
test('la demo de grupo sólo toma farmacias activas y genera alias ficticios',()=>{
 const rows=prepareDemoPharmacyMapping(pharmacies,{scope:'multifarmacia'});
 assert.deepEqual(rows.map(p=>p.demoName),['Farmacia Demo 01','Farmacia Demo 02']);
 assert.deepEqual(rows.map(p=>p.demoCode),['DEMO01','DEMO02']);
 assert.deepEqual(rows.map(p=>p.sourcePharmacyId),[1,2]);
});
test('la demo de una sola farmacia no incluye el resto del grupo',()=>{
 const rows=prepareDemoPharmacyMapping(pharmacies,{scope:'monofarmacia',sourcePharmacyId:2});
 assert.equal(rows.length,1);
 assert.equal(rows[0].sourcePharmacyId,2);
 assert.equal(rows[0].demoName,'Farmacia Demo 01');
 assert.throws(()=>prepareDemoPharmacyMapping(pharmacies,{scope:'monofarmacia',sourcePharmacyId:3}));
});
test('no permite duplicados, almacenes ni scope mixto',()=>{
 assert.throws(()=>prepareDemoPharmacyMapping([{id:1},{id:1}],{scope:'multifarmacia'}));
 assert.throws(()=>prepareDemoPharmacyMapping(pharmacies,{scope:'multifarmacia',sourcePharmacyId:1}));
});
test('ninguna demo viva o no auditada puede declararse publicable',()=>{
 const ready={slug:'demo_grupo',sourceSlug:'ampedia',scope:'multifarmacia',
  storage:'base_independiente',connectionAlias:'FM_DB_DEMO_GRUPO',
  sourceConnectionAlias:'FM_DB_AMPEDIA',
  anonymizationAuditPassed:true,anonymizationVersion:1,
  dataVerificationPassed:true,movementSource:'sanitized_snapshot'};
 assert.deepEqual(validateDemoActivation(ready),{allowed:true});
 for(const override of [
  {storage:'esquema_heredado'}, {movementSource:'live_views'},
  {anonymizationAuditPassed:false}, {anonymizationVersion:0},
  {dataVerificationPassed:false},
  {connectionAlias:'FM_DB_AMPEDIA'}, {connectionAlias:'postgres://secret'},
  {slug:'ampedia'}, {sourceSlug:'demo_grupo'}
 ]){
  assert.equal(validateDemoActivation({...ready,...override}).allowed,false,
   JSON.stringify(override));
 }
});
