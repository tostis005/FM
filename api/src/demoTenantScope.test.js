import test from 'node:test';
import assert from 'node:assert/strict';
import {setupTenant} from './tenant.js';

test('demo individual: contexto excluye farmacias inactivas y mantiene código técnico para consultas',async()=>{
 const routes=new Map(),calls=[];
 const app={
  get:(path,...handlers)=>routes.set('GET '+path,handlers),
  post:(path,...handlers)=>routes.set('POST '+path,handlers),
  put:(path,...handlers)=>routes.set('PUT '+path,handlers),
  patch:(path,...handlers)=>routes.set('PATCH '+path,handlers),
  delete:(path,...handlers)=>routes.set('DELETE '+path,handlers)
 };
 const pool={async query(sql,params=[]){
  calls.push({sql,params});
  if(sql.includes('SELECT slug,nombre,esquema_datos,activo,analisis_abcd_meses'))
   return {rows:[{slug:'demo_individual',nombre:'Demo Individual',
    esquema_datos:'demo_individual',activo:true,analisis_abcd_meses:12,
    demo_origen_slug:'ampedia',appearance:null}]};
  if(sql.includes('SELECT modulo_clave AS id'))
   return {rows:[{id:'ventas',enabled:true}]};
  if(sql.includes('FROM farmetrica.farmacias f WHERE f.cliente_slug=$1 ORDER BY f.id'))
   return {rows:[
    {id:'101',name:'Farmacia Pérez',active:true,sourceCode:'ABA',displayCode:'PER',establishmentType:'farmacia'},
    {id:'102',name:'Farmacia Deshabilitada',active:false,sourceCode:'EUR',displayCode:'NOR',establishmentType:'farmacia'}
   ]};
  if(sql.includes('SELECT nombre AS name') && sql.includes('farmetrica.farmacias f'))
   return {rows:[{name:'Abadía',databaseCode:'ABA'},{name:'Europa',databaseCode:'EUR'}]};
  if(sql.includes('SELECT slug,nombre AS name FROM farmetrica.clientes'))
   return {rows:[{slug:'demo_individual',name:'Demo Individual'}]};
  throw Error('SQL mock no esperado: '+sql);
 }};
 setupTenant(app,pool,{requireUser:(r,s,next)=>next(),requireSuperadmin:(r,s,next)=>next()});
 const chain=routes.get('GET /api/tenant/context');
 const req={user:{email:'demo@example.com',name:'Demo',role:'usuario',
   tenants:[{slug:'demo_individual',role:'administrador',active:true,pharmacies:[101,102]}]},
  query:{},get:key=>key==='x-farmetrica-cliente'?'demo_individual':''};
 let status=200,payload,fail;
 const res={status(x){status=x;return this},json(x){payload=x;return this}};
 await chain[1](req,res,error=>{fail=error});
 assert.equal(fail,undefined);
 assert.deepEqual(req.context.allowedPharmacyIds,[101]);
 assert.equal(req.context.pharmacies.length,1);
 assert.equal(req.context.pharmacies[0].databaseCode,'ABA','SQL interno usa el código real');
 await chain[2](req,res,error=>{fail=error});
 assert.equal(fail,undefined);
 assert.equal(status,200);
 assert.equal(payload.pharmacies[0].sourceCode,'PER');
 assert.equal(payload.pharmacies[0].databaseCode,'ABA','El código técnico se necesita en la web para cruces ERP');
 assert.equal(payload.pharmacies[0].name,'Farmacia Pérez');
 assert.equal(payload.pharmacies.some(p=>p.name==='Farmacia Deshabilitada'),false);
 assert.equal(payload.establishments.length,1);
 assert.ok(calls.some(x=>x.sql.includes('farmetrica.farmacias f')&&x.params[0]==='ampedia'));
});

test('gestor sin asignaciones accede a todas las farmacias de su cliente; personal de farmacia no',async()=>{
 const routes=new Map();
 const app={get:(path,...handlers)=>routes.set('GET '+path,handlers),
  post:()=>{},put:()=>{},patch:()=>{},delete:()=>{}};
 const pool={async query(sql){
  if(sql.includes('SELECT slug,nombre,esquema_datos,activo,analisis_abcd_meses'))
   return {rows:[{slug:'cliente_prueba',nombre:'Cliente prueba',esquema_datos:'cliente_prueba',
     activo:true,analisis_abcd_meses:12,demo_origen_slug:null,appearance:null}]};
  if(sql.includes('SELECT modulo_clave AS id'))
   return {rows:[{id:'promociones',enabled:true},{id:'ventas',enabled:true}]};
  if(sql.includes('FROM farmetrica.farmacias f WHERE f.cliente_slug=$1 ORDER BY f.id'))
   return {rows:[{id:'1',name:'Farmacia Uno',active:true,sourceCode:'UNO',establishmentType:'farmacia'},
    {id:'2',name:'Farmacia Dos',active:true,sourceCode:'DOS',establishmentType:'farmacia'},
    {id:'3',name:'Almacén',active:true,sourceCode:'ALM',establishmentType:'almacen'}]};
  if(sql.includes('SELECT slug,nombre AS name FROM farmetrica.clientes'))
   return {rows:[{slug:'cliente_prueba',name:'Cliente prueba'}]};
  throw Error('Consulta inesperada: '+sql);
 }};
 setupTenant(app,pool,{requireUser:(req,res,next)=>next(),
  requireSuperadmin:(req,res,next)=>next()});
 const chain=routes.get('GET /api/tenant/context');
 async function contextFor(role,assigned){
  const req={user:{email:role+'@example.com',name:role,role:'usuario',
    tenants:[{slug:'cliente_prueba',role,active:true,pharmacies:assigned}]},
   query:{},get:key=>key==='x-farmetrica-cliente'?'cliente_prueba':''};
  let payload,error;
  const res={status(){return res},json(x){payload=x;return res}};
  await chain[1](req,res,e=>{error=e});
  assert.equal(error,undefined);
  const scope=req.context.allowedPharmacyIds;
  await chain[2](req,res,e=>{error=e});
  assert.equal(error,undefined);
  return {scope,payload};
 }
 const manager=await contextFor('gestor',[]);
 assert.deepEqual(manager.scope,[1,2]);
 assert.deepEqual(manager.payload.pharmacies.map(p=>p.id),['1','2']);
 assert.equal(manager.payload.role,'gestor');
 assert.equal(manager.payload.pharmacies.some(p=>p.establishmentType==='almacen'),false);
 const managerWithOne=await contextFor('gestor',[1]);
 assert.deepEqual(managerWithOne.scope,[1,2]);
 const employee=await contextFor('farmacia',[1]);
 assert.deepEqual(employee.scope,[1]);
 assert.deepEqual(employee.payload.pharmacies.map(p=>p.id),['1']);
});
