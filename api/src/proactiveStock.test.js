import test from "node:test";
import assert from "node:assert/strict";
import {proactiveFilters,proactiveCoverageSQL,buildProactiveStockSQL,setupProactiveStock} from "./proactiveStock.js";

const req=(query={})=>({query,context:{client:{schema:"ampedia",slug:"ampedia"},
 role:"superadministrador",allowedPharmacyIds:[1,2]},user:{role:"superadministrador"}});
test("acepta solo períodos y farmacias del cliente",()=>{
 assert.deepEqual(proactiveFilters(req({dias:"90",farmacias:"1,2,1"}),"alertas").ids,[1,2]);
 assert.equal(proactiveFilters(req({dias:"180"}),"inmovilizado").days,180);
 assert.throws(()=>proactiveFilters(req({farmacias:"3"}),"alertas"),e=>e.status===403);
 assert.throws(()=>proactiveFilters(req({farmacias:"1,abc"}),"alertas"),e=>e.status===400);
 assert.throws(()=>proactiveFilters(req({dias:"365"}),"alertas"),e=>e.status===400);
 assert.throws(()=>proactiveFilters(req({pagina:"-1"}),"alertas"),e=>e.status===400);
 assert.throws(()=>proactiveFilters(req(),"foo"),e=>e.status===400);
});
test("SQL usa contratos documentales y rechaza esquemas inyectados",()=>{
 for(const mode of ["alertas","inmovilizado"]){
  const sql=buildProactiveStockSQL("ampedia",mode);
  assert.match(sql,/fm_ventas_analitica/);
  assert.match(sql,/stock_actual>0/);
  assert.match(sql,/sincronizado_en>=now\(\)-interval '7 days'/);
  assert.match(sql,/count\(capital\) OVER\(\)/);
  assert.match(sql,/LIMIT \$5::int OFFSET \$6::int/);
  assert.match(sql,/v\.articulo_id/);
  assert.doesNotMatch(sql,/UPDATE |DELETE |INSERT /);
 }
 assert.match(proactiveCoverageSQL("ampedia"),/fm_ventas_cabeceras/);
 assert.throws(()=>buildProactiveStockSQL("ampedia;DROP SCHEMA public","alertas"));
});
test("ambas APIs deniegan acceso sin rol superadministrador antes de consultar",()=>{
 const routes=[];
 setupProactiveStock({get:(path,...middleware)=>routes.push({path,middleware})},
  {query:()=>{throw Error("No debe consultar base de datos");}},
  {requireTenant:()=>[(request,response,next)=>next()]});
 assert.equal(routes.length,2);
 for(const route of routes){
  const response={code:200,body:null,status(n){this.code=n;return this;},
   json(x){this.body=x;return this;}};
  const request=req();request.user.role="administrador";request.context.role="administrador";
  route.middleware[1](request,response,()=>assert.fail("Acceso indebido"));
  assert.equal(response.code,403);
  assert.match(response.body.error,/superadministrador/);
 }
});
test("datos incompletos no producen alertas ni valoraciones ficticias",async()=>{
 const routes=[];
 let queryCount=0;
 setupProactiveStock({get:(path,...middleware)=>routes.push({path,middleware})},
  {query:async()=>{queryCount++;if(queryCount===1)return {rows:[{t0:true,t1:true,t2:true}]};
   return {rows:[{id:1,nombre:"Farmacia uno",stock_ok:false,sales_ok:true}]};}},
  {requireTenant:()=>[]});
 const route=routes.find(x=>x.path.endsWith("/inmovilizado"));
 const response={code:200,body:null,status(n){this.code=n;return this;},
  json(x){this.body=x;return this;}};
 await route.middleware[1](req(),response);
 assert.equal(response.code,200);
 assert.equal(response.body.available,false);
 assert.equal(response.body.rows.length,0);
 assert.equal(queryCount,2);
});
