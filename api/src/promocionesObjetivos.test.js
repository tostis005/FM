import test from "node:test";
import assert from "node:assert/strict";
import {setupPromotionObjectives} from "./promocionesObjetivos.js";

function fixture(){
 const routes=new Map(),queries=[];
 const pool={async query(sql,params=[]){
  queries.push({sql,params});
  if(sql.includes("SELECT DISTINCT f.id::text AS pharmacy_id"))
   return {rows:[{pharmacy_id:"1",source_id:"ERP-123"}]};
  if(sql.includes("coalesce(sum(v.unidades)"))
   return {rows:[{pharmacy_id:"1",units:7,amount:53.8}]};
  if(sql.includes("WITH catalog"))
   return {rows:[{cn:"123456",description:"Artículo de prueba"}]};
  throw Error("Consulta SQL inesperada: "+sql);
 }};
 const app={post(path,...handlers){routes.set(path,handlers.at(-1));}};
 setupPromotionObjectives(app,pool,{requireTenantModule:()=>[]});
 async function call(path,body,scope=[1,2]){
  const req={body,context:{role:"gestor",client:{slug:"ampedia",schema:"ampedia"},
   allowedPharmacyIds:scope}};
  let status=200,response=null,error=null;
  const res={status(code){status=code;return res;},json(data){response=data;return res;}};
  await routes.get(path)(req,res,e=>{error=e;});
  if(error)throw error;
  return {status,response};
 }
 return {call,queries};
}
const periods=[{id:"october",from:"2026-10-01",to:"2026-10-31"}];
test("histórico por farmacia devuelve unidades e importe neto",async()=>{
 const api=fixture();
 const {status,response}=await api.call("/api/ventas/objetivos/historico",
   {cns:["123456"],pharmacyIds:[1],periods});
 assert.equal(status,200);
 assert.deepEqual(response.periods,{october:{"1":7}});
 assert.deepEqual(response.amounts,{october:{"1":53.8}});
 assert.deepEqual(api.queries[0].params,["ampedia",[1],["123456"]]);
 assert.deepEqual(api.queries[1].params,
   ["ampedia",[1],"2026-10-01","2026-10-31",["123456"],["1|ERP-123"]]);
 assert.match(api.queries[1].sql,/sum\(v.importe\)/);
});
test("prohíbe leer ventas de otras farmacias sin lanzar ninguna consulta",async()=>{
 const api=fixture();
 const out=await api.call("/api/ventas/objetivos/historico",
   {cns:["123456"],pharmacyIds:[2],periods},[1]);
 assert.equal(out.status,403);
 assert.equal(api.queries.length,0);
});
test("permite buscar por CN en el catálogo autorizado",async()=>{
 const api=fixture();
 const out=await api.call("/api/ventas/objetivos/buscar",{cns:["123456"],search:""});
 assert.equal(out.status,200);
 assert.deepEqual(out.response.products,[{cn:"123456",description:"Artículo de prueba"}]);
 assert.deepEqual(api.queries[0].params.slice(0,2),["ampedia",[1,2]]);
});
test("rechaza rangos inválidos antes de consultar PostgreSQL",async()=>{
 const api=fixture();
 const invalid=await api.call("/api/ventas/objetivos/historico",{
   cns:["123456"],pharmacyIds:[1],periods:[{id:"future",from:"2026-10-31",to:"2026-10-01"}]});
 assert.equal(invalid.status,400);
 assert.equal(api.queries.length,0);
});
