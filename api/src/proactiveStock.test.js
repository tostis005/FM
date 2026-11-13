import test from "node:test";
import assert from "node:assert/strict";
import {
 proactiveFilters,proactiveCoverageSQL,proactiveInventorySQL,proactiveSalesSliceSQL,
 classifyProactiveStock,setupProactiveStock,getProactiveJob,proactiveJobResponse
} from "./proactiveStock.js";

const req=(query={},slug="prueba_alertas")=>({query,
 context:{client:{schema:"ampedia",slug},role:"superadministrador",allowedPharmacyIds:[1,2]},
 user:{role:"superadministrador"}});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function finish(job){
 for(let i=0;i<50&&["queued","checking","calculating"].includes(job.status);i++)await delay(10);
 return job;
}
test("validación estricta de farmacias, período y token de recálculo",()=>{
 assert.deepEqual(proactiveFilters(req({dias:"90",farmacias:"1,2,1"}),"alertas").ids,[1,2]);
 assert.equal(proactiveFilters(req({dias:"180"}),"inmovilizado").days,180);
 assert.throws(()=>proactiveFilters(req({farmacias:"3"}),"alertas"),e=>e.status===403);
 assert.throws(()=>proactiveFilters(req({farmacias:"1,abc"}),"alertas"),e=>e.status===400);
 assert.throws(()=>proactiveFilters(req({dias:"365"}),"alertas"),e=>e.status===400);
 assert.throws(()=>proactiveFilters(req({pagina:"-1"}),"alertas"),e=>e.status===400);
 assert.throws(()=>proactiveFilters(req({recalcular:"1; DROP"}),"alertas"),e=>e.status===400);
 assert.throws(()=>proactiveFilters(req(),"foo"),e=>e.status===400);
});
test("SQL troceado solo lee artículos y documentos completos en su tenant",()=>{
 for(const sql of [proactiveInventorySQL("ampedia"),proactiveSalesSliceSQL("ampedia"),
  proactiveCoverageSQL("ampedia")]){
  assert.match(sql,/"ampedia"\./);
  assert.doesNotMatch(sql,/UPDATE |DELETE |INSERT /);
 }
 const sql=proactiveSalesSliceSQL("ampedia");
 assert.match(sql,/fm_ventas_lineas/);
 assert.match(sql,/lineas_completas AND NOT h.eliminado_logicamente/);
 assert.match(sql,/h.fecha >= \$2::date AND h.fecha < \$3::date/);
 assert.match(sql,/h.fecha>=\$4::date/);
 assert.match(sql,/l\.devuelta/);
 assert.match(proactiveInventorySQL("ampedia"),/a.stock_actual>0/);
 assert.throws(()=>proactiveSalesSliceSQL("ampedia;DROP SCHEMA public"));
});
test("señales de riesgo, cobertura y capital no mezclan falta de coste con cero",()=>{
 const stock={pharmacyId:"1",articleId:"R1",stock:2,unitCost:null};
 const risk=classifyProactiveStock(stock,{units:20,units30:20},90);
 assert.equal(risk.alertType,"rotura");
 assert.equal(risk.capital,null);
 assert.equal(risk.coverDays,9);
 const idle=classifyProactiveStock({...stock,unitCost:10,stock:5},{units:-2,units30:-2},90);
 assert.equal(idle.alertType,"sin_ventas");
 assert.equal(idle.unitsPeriod,0);
 assert.equal(idle.capital,50);
 const excess=classifyProactiveStock({...stock,stock:100},{units:3,units30:0},90);
 assert.equal(excess.alertType,"exceso");
 assert.equal(classifyProactiveStock({...stock,stock:10},{units:100,units30:0},90).alertType,null);
});
test("deniega las dos rutas a usuarios no superadmin antes de consultar",()=>{
 const routes=[];
 setupProactiveStock({get:(path,...middleware)=>routes.push({path,middleware})},
  {query:()=>assert.fail("No debe consultar la base de datos")},
  {requireTenant:()=>[(request,response,next)=>next()]});
 assert.equal(routes.length,2);
 for(const route of routes){
  const response={code:200,body:null,status(n){this.code=n;return this;},
   json(x){this.body=x;return this;}};
  const request=req();request.user.role="administrador";request.context.role="administrador";
  route.middleware[1](request,response,()=>assert.fail("Acceso indebido"));
  assert.equal(response.code,403);
 }
});
test("empieza a responder antes del cómputo y comparte resultado entre pantallas",async()=>{
 const queries=[];
 const pool={async query(request,values){
  const sql=typeof request==="string"?request:request.text;
  queries.push({sql,values:values||request.values});
  if(sql.includes("to_regclass"))return {rows:[{t0:true,t1:true,t2:true}]};
  if(sql.includes("stock_ok"))return {rows:[{id:1,nombre:"Farmacia uno",code:"ABA",
   stock_ok:true,sales_ok:true}]};
  if(sql.includes("a.stock_actual>0"))return {rows:[{
   pharmacyId:"1",pharmacyName:"Farmacia uno",articleId:"R1",cn:"123456",name:"Artículo",
   stock:5,unitCost:3,stockAt:"2026-11-13"
  }]};
  if(sql.includes("GROUP BY l.articulo_origen_id"))return {rows:[]};
  assert.fail("Consulta inesperada: "+sql.slice(0,80));
 }};
 const f=proactiveFilters(req({farmacias:"1"},"unica_segura"),"alertas");
 const job=getProactiveJob(pool,f);
 assert.ok(["queued","checking","calculating","complete"].includes(job.status));
 assert.equal((await finish(job)).status,"complete");
 assert.equal(job.completedSites,1);
 const first=proactiveJobResponse(job,f);
 assert.equal(first.total,1);
 assert.equal(first.rows[0].alertType,"sin_ventas");
 assert.equal(first.rows[0].capital,15);
 const other=proactiveJobResponse(job,{...f,mode:"inmovilizado"});
 assert.equal(other.total,1);
 assert.equal(getProactiveJob(pool,{...f,mode:"inmovilizado"}),job);
 assert.ok(queries.length>=4);
});
test("fallo de una farmacia no se convierte en ventas cero",async()=>{
 const pool={async query(request){
  const sql=typeof request==="string"?request:request.text;
  if(sql.includes("to_regclass"))return {rows:[{t0:true,t1:true,t2:true}]};
  if(sql.includes("stock_ok"))return {rows:[{id:1,nombre:"Farmacia uno",code:"ABA",
   stock_ok:true,sales_ok:true}]};
  if(sql.includes("a.stock_actual>0"))return {rows:[{
   pharmacyId:"1",pharmacyName:"Farmacia uno",articleId:"R1",cn:"123456",name:"Artículo",
   stock:5,unitCost:null
  }]};
  if(sql.includes("GROUP BY l.articulo_origen_id"))
   throw Object.assign(Error("Faltan permisos de lectura"),{code:"42501"});
  assert.fail("Consulta inesperada");
 }};
 const f=proactiveFilters(req({farmacias:"1"},"fallo_verificable"),"alertas");
 const job=await finish(getProactiveJob(pool,f));
 assert.equal(job.status,"unavailable");
 const result=proactiveJobResponse(job,f);
 assert.equal(result.available,false);
 assert.equal(result.total,0);
 assert.equal(result.excluded.length,1);
 assert.match(result.excluded[0].reason,/verificar/);
});
test("farmacias sin información reciente no generan recomendaciones",async()=>{
 let calls=0;
 const pool={async query(request){
  calls++;
  if(calls===1)return {rows:[{t0:true,t1:true,t2:true}]};
  return {rows:[{id:1,nombre:"Farmacia uno",code:"ABA",stock_ok:false,sales_ok:true}]};
 }};
 const f=proactiveFilters(req({farmacias:"1"},"datos_obsoletos"),"inmovilizado");
 const job=await finish(getProactiveJob(pool,f));
 assert.equal(job.status,"unavailable");
 assert.equal(proactiveJobResponse(job,f).rows.length,0);
 assert.equal(calls,2);
});
