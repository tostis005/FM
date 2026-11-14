import test from 'node:test';
import assert from 'node:assert/strict';
import {tenantScopedPharmacyIds} from './tenantPharmacyScope.js';

const pharmacies=[{id:'1',active:true},{id:'2',active:false},{id:'3',active:true}];
test('demo: administrador sólo ve farmacias habilitadas',()=>{
 assert.deepEqual(tenantScopedPharmacyIds(pharmacies,{demo:true,privileged:true}),[1,3]);
});
test('demo: usuario no puede incluir farmacias deshabilitadas aunque esté asignado',()=>{
 assert.deepEqual(tenantScopedPharmacyIds(pharmacies,{demo:true,assignedIds:[2,3,999]}),[3]);
});
test('cliente real: se preserva exactamente el ámbito heredado',()=>{
 assert.deepEqual(tenantScopedPharmacyIds(pharmacies,{privileged:true}),[1,2,3]);
 assert.deepEqual(tenantScopedPharmacyIds(pharmacies,{assignedIds:[2,3]}),[2,3]);
});
test('sin asignación no se habilita ninguna farmacia para usuario no administrador',()=>{
 assert.deepEqual(tenantScopedPharmacyIds(pharmacies,{demo:true}),[]);
});
