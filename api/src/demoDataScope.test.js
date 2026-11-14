import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveDemoSourceScope,mapDemoPharmacyIds} from './demoDataScope.js';

test('se reutilizan los IDs/cierres de origen sin mostrar códigos de datos incorrectos',async()=>{
 let executed;
 const pool={query:async(sql,params)=>{
  executed={sql,params};
  return {rows:[{sourceSlug:'ampedia',sourceSchema:'ampedia',
    demoId:100,sourceId:1,code:'ABA'},{sourceSlug:'ampedia',sourceSchema:'ampedia',
    demoId:102,sourceId:5,code:'VAL'}]};
 }};
 const ctx={client:{demo:true,slug:'demo_farmetrica'},
  pharmacies:[{id:'100',name:'Farmacia Uno',databaseCode:'ABA'},
    {id:'102',name:'Farmacia Dos',databaseCode:'VAL'}]};
 const scope=await resolveDemoSourceScope(pool,ctx,[102,100]);
 assert.deepEqual(executed.params,['demo_farmetrica',[102,100]]);
 assert.match(executed.sql,/sf\.cliente_slug=src\.slug/);
 assert.match(executed.sql,/df\.activo=true/);
 assert.deepEqual(scope.ids,[5,1]);
 assert.deepEqual(scope.farms,[{id:5,code:'VAL'},{id:1,code:'ABA'}]);
 assert.equal(scope.pharmacies[0].name,'Farmacia Dos');
 const data={actividad:{byPharmacy:[{pharmacyId:'5',sales:20},{pharmacyId:'1',sales:10}]},
  rows:[{farmaciaId:1,sourceId:1,cn:'000001'}]};
 const masked=mapDemoPharmacyIds(data,scope.idMap);
 assert.equal(masked.actividad.byPharmacy[0].pharmacyId,'102');
 assert.equal(masked.rows[0].farmaciaId,100);
 assert.equal(masked.rows[0].sourceId,1);
 assert.equal(data.actividad.byPharmacy[0].pharmacyId,'5');
});
test('nunca remapear al cliente original ni aceptar farmacias sin correspondencia',async()=>{
 const real={client:{demo:false,slug:'ampedia'}};
 assert.equal(await resolveDemoSourceScope({query(){throw Error('no')}} ,real,[1]),null);
 const pool={query:async()=>({rows:[]})};
 await assert.rejects(resolveDemoSourceScope(pool,{client:{demo:true,slug:'demo_individual'}},[99]),
  /no corresponde/);
});
