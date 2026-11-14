import test from 'node:test';
import assert from 'node:assert/strict';
import {ensureDemoViews,DEMO_SOURCE_TABLES,setupDemoClients} from './demoClients.js';

test('demo enlazada tiene vistas documentales de solo lectura sin copiar movimientos',async()=>{
 const queries=[];
 const db={async query(sql,params=[]){
  queries.push({sql,params});
  if(sql.startsWith('SELECT 1 FROM pg_class'))
   return {rows:params[0]==='ampedia'?[{exists:true}]:[]};
  if(sql.startsWith('SELECT c.relkind'))return {rows:[]};
  return {rows:[]};
 }};
 await ensureDemoViews(db,'demo_grupo','ampedia');
 const views=queries.filter(q=>q.sql.startsWith('CREATE VIEW'));
 assert.equal(views.length,DEMO_SOURCE_TABLES.length);
 assert.ok(views.some(q=>q.sql.includes('demo_grupo"."fm_ventas_analitica')));
 assert.ok(views.some(q=>q.sql.includes('demo_grupo"."fm_ventas_lineas')));
 assert.ok(views.every(q=>q.sql.includes('CROSS JOIN (SELECT true AS solo_lectura)')));
 assert.ok(views.every(q=>!q.sql.includes('INSERT INTO')));
 assert.ok(!DEMO_SOURCE_TABLES.includes('fm_promociones'));
 await assert.rejects(ensureDemoViews(db,'ampedia','ampedia'));
});

test('alta monofarmacia habilita una sola farmacia y guarda cliente propio',async()=>{
 const routes={};
 const app={post:(url,...handlers)=>routes[url]=handlers};
 const sql=[],db={async query(query,params=[]){
  sql.push({query,params});
  if(query.includes('SELECT slug,esquema_datos,analisis_abcd_meses'))return {
   rows:[{slug:'ampedia',esquema_datos:'ampedia',analisis_abcd_meses:12}]};
  if(query.includes('SELECT 1 FROM pg_namespace'))return {rows:[]};
  if(query.includes('SELECT 1 FROM pg_class'))return {rows:[]};
  if(query.includes('VALUES($1,$2,$1,$3,$4) RETURNING slug'))
   return {rows:[{slug:'demo_individual'}]};
  if(query.includes('count(*)::int AS n,count(*) FILTER'))
   return {rows:[{n:5,enabled:1}]};
  return {rows:[]};
 },release(){}};
 const pool={connect:async()=>db};
 setupDemoClients(app,pool,{requireSuperadmin:(req,res,next)=>next()});
 const endpoint=routes['/api/admin/clientes/demo'];
 assert.ok(endpoint);
 const req={body:{slug:'demo_individual',name:'Demo Individual',sourceSlug:'ampedia',scope:'single'}};
 let status=200,output,error;
 const res={status(code){status=code;return this},json(value){output=value;return this}};
 await endpoint[1](req,res,e=>{error=e});
 assert.equal(error,undefined);
 assert.equal(status,201);
 assert.equal(output.enabledPharmacies,1);
 assert.ok(sql.some(q=>q.query.includes("($3='all' OR n=1)")&&q.params[2]==='single'));
 assert.ok(sql.some(q=>q.query.includes('INSERT INTO farmetrica.clientes')));
 assert.ok(!sql.some(q=>q.query.includes('DELETE FROM "ampedia"')||q.query.includes('UPDATE "ampedia"')));
});
