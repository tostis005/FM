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
