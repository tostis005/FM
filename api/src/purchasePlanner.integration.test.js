import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {setupPurchasePlanner} from "./purchasePlanner.js";

test("PostgreSQL: preparador consulta ventas documentales y stock real, filtrando por CN",{
 skip:!process.env.TEST_DB_URL
},async()=>{
 const pool=new pg.Pool({connectionString:process.env.TEST_DB_URL});
 try{
  await pool.query("UPDATE ampedia.articulos SET stock_actual=0,sincronizado_en=now() WHERE farmacia_codigo='ABA' AND origen_id='ART-02'");
  const routes={},app={get(path,...handlers){routes[path]=handlers.at(-1)}};
  setupPurchasePlanner(app,pool,{requireTenant:()=>[]});
  const req={query:{desde:"2026-10-01",hasta:"2026-10-21",farmacias:"1",buscar:"654322"},
   context:{role:"superadministrador",client:{schema:"ampedia",slug:"ampedia"},
    modules:{compras:true},pharmacies:[
     {id:"1",name:"Abadía",sourceCode:"ABA",databaseCode:"ABA"},
     {id:"2",name:"Europa",sourceCode:"EUR",databaseCode:"EUR"}]}};
  let code=200,body,error;
  const res={status(n){code=n;return this},json(v){body=v;return this}};
  await routes["/api/analytics/pedidos/propuesta"](req,res,e=>{error=e});
  if(error)throw error;
  assert.equal(code,200);
  assert.equal(body.available,true);
  assert.ok(body.groups.length>0,"debe poder buscar un CN real, aunque el ERP tenga otro ID");
  // Si el CN corresponde a un EFG, su fila es el conjunto DCPF;
  // si no, sigue agrupado como CN. Siempre conserva ERP y stock exactos.
  const line=body.groups.find(g=>g.pharmacies.some(p=>
   p.options.some(o=>o.cn==="654322"&&o.articleId==="ART-02")));
  assert.ok(line,"el CN buscado debe aparecer en el grupo real");
  assert.equal(line.pharmacies.length,1);
  const reference=line.pharmacies[0].options.find(o=>o.cn==="654322");
  assert.equal(reference.stock,0);
  assert.ok(line.pharmacies[0].units3>0);
  assert.ok(line.pharmacies[0].suggested===null||line.pharmacies[0].suggested>=0);
  assert.equal(reference.articleId,"ART-02");
  // El preparador también puede recibir un artículo del comparador PUC
  // sin ventas en el período: se permite añadirlo manualmente, sin inventar demanda.
  req.query.buscar="654321";
  body=null;error=null;
  await routes["/api/analytics/pedidos/propuesta"](req,res,e=>{error=e});
  if(error)throw error;
  const unSold=body.groups.find(g=>g.pharmacies.some(p=>p.options.some(o=>
   o.cn==="654321"&&o.articleId==="ART-01")));
  assert.ok(unSold,"la búsqueda incluye artículos del catálogo sin ventas: "+JSON.stringify(body).slice(0,1100));
  assert.ok(unSold.pharmacies[0].options.some(o=>o.articleId==="ART-01"));
 }finally{await pool.end()}
});


test("PostgreSQL: concentración y recurrencia se distinguen por fechas de venta, no por CN",{
 skip:!process.env.TEST_DB_URL
},async()=>{
 const pool=new pg.Pool({connectionString:process.env.TEST_DB_URL});
 const db=await pool.connect();
 try{
  await db.query("BEGIN");
  await db.query(`INSERT INTO ampedia.articulos
   (farmacia_codigo,origen_id,nombre,codigo_nacional,stock_actual,sincronizado_en)
   VALUES ('ABA','990001','Artículo de prueba A',NULL,0,now()),
    ('ABA','990002','Artículo de prueba B',NULL,0,now())
   ON CONFLICT DO NOTHING`);
  await db.query(`INSERT INTO ampedia.fm_ventas_cabeceras
   (farmacia_codigo,sistema_origen,documento_id,fecha,lineas_completas)
   SELECT 'ABA','farmatic','PATRON-A-'||i,current_date-interval '70 days'
     +(i-1)*interval '1 day',true FROM generate_series(1,4) i
   UNION ALL
   SELECT 'ABA','farmatic','PATRON-B-'||i,current_date-interval '330 days'
     +(i-1)*interval '29 days',true FROM generate_series(1,12) i`);
  await db.query(`INSERT INTO ampedia.fm_ventas_lineas
   (farmacia_codigo,sistema_origen,documento_id,linea_id,articulo_origen_id,cantidad,importe_neto)
   SELECT 'ABA','farmatic','PATRON-A-'||i,'1','990001',40,40 FROM generate_series(1,4) i
   UNION ALL
   SELECT 'ABA','farmatic','PATRON-B-'||i,'1','990002',2,2 FROM generate_series(1,12) i`);
  const routes={},app={get(path,...handlers){routes[path]=handlers.at(-1)}};
  setupPurchasePlanner(app,db,{requireTenant:()=>[]});
  const stamp=d=>d.toISOString().slice(0,10);
  const from=stamp(new Date(Date.now()-28*86400000)),to=stamp(new Date());
  const ctx={role:"superadministrador",client:{slug:"ampedia",schema:"ampedia"},
   modules:{compras:true},pharmacies:[{id:"1",name:"Abadía"}]};
  async function getArticle(cn){
   let data=null,error=null,status=200;
   const res={status(n){status=n;return this},json(d){data=d;return this}};
   await routes["/api/analytics/pedidos/propuesta"]({
    query:{desde:from,hasta:to,farmacias:"1",buscar:cn,pagina:"1",tamano:"50"},context:ctx
   },res,e=>{error=e});
   if(error)throw error;
   assert.equal(status,200);
   const group=data.groups.find(g=>g.cn===cn);
   assert.ok(group,"Debe encontrarse el código nacional "+cn);
   return group;
  }
  const concentrated=await getArticle("990001");
  assert.equal(concentrated.patron,"concentrada");
  assert.equal(concentrated.suggested,0);
  assert.equal(concentrated.saleSpanDays,4);
  assert.equal(concentrated.units12,160);
  const recurring=await getArticle("990002");
  assert.equal(recurring.patron,"recurrente");
  assert.ok(recurring.saleSpanDays>=300);
  assert.ok(recurring.activeQuarters>=3);
  assert.ok(recurring.suggested>0);
  assert.equal(recurring.units12,24);
 }finally{
  await db.query("ROLLBACK").catch(()=>{});
  db.release();
  await pool.end();
 }
});
