import test from "node:test";
import assert from "node:assert/strict";
import {buildAgenda,civilDays,validOrderDate,setupPreparadorAgenda} from "./preparadorAgenda.js";

test("la agenda agrupa por laboratorio y mantiene vencimientos distintos por farmacia",()=>{
 const result=buildAgenda([
  {id:"10",name:"Cinfa",days:3,pharmacyId:1,pharmacyName:"Abadía",lastOrder:"2026-10-20"},
  {id:"10",name:"Cinfa",days:3,pharmacyId:2,pharmacyName:"Europa",lastOrder:"2026-10-28"},
  {id:"20",name:"Isdin",days:7,pharmacyId:1,pharmacyName:"Abadía",lastOrder:null}
 ],"2026-10-29");
 assert.equal(result.length,2);
 assert.equal(result[0].key,"P:10");
 assert.equal(result[0].overdue,1);
 assert.equal(result[0].pharmacies[0].status,"vencido");
 assert.equal(result[0].pharmacies[0].nextDue,"2026-10-23");
 assert.equal(result[0].pharmacies[1].nextDue,"2026-10-31");
 assert.equal(result[1].withoutDate,1);
 assert.equal(result[1].pharmacies[0].status,"sin_fecha");
 assert.equal(civilDays("2026-10-29","2026-10-31"),2);
 assert.equal(validOrderDate("2026-02-29"),false);
 assert.equal(validOrderDate("2024-02-29"),true);
});

function mock(){
 const routes={},queries=[];
 const app={get(path,...handlers){routes["GET "+path]=handlers.at(-1)},
  post(path,...handlers){routes["POST "+path]=handlers.at(-1)},
  delete(path,...handlers){routes["DELETE "+path]=handlers.at(-1)}};
 const pool={query:async(q)=>{queries.push(q);return {rows:[]}},
  connect:async()=>({query:async(q,values)=>{queries.push({q,values});
   if(String(q).includes("RETURNING farmacia_id"))return {rows:values[2].map(farmacia_id=>({farmacia_id}))};
   return {rows:[]}},release(){}})};
 setupPreparadorAgenda(app,pool,{requireTenant:()=>[]});
 const context={client:{slug:"ampedia"},role:"administrador",
  modules:{compras:true},pharmacies:[{id:1},{id:2}]};
 async function call(method,path,data={},overrides={}){
  const handler=routes[method+" "+path];assert.ok(handler,path);
  let status=200,body,err;
  await handler({context:{...context,...overrides},user:{email:"admin@example.org"},
   query:method==="GET"?data:{},body:method==="POST"?data:{},
   params:method==="DELETE"?{group:data.group}:{}},
   {status(code){status=code;return this},json(payload){body=payload;return this}},
   e=>{err=e});
  if(err)throw err;
  return {status,body};
 }
 return {call,queries};
}
test("no se permiten farmacias fuera del tenant ni confirmar sin fecha válida",async()=>{
 const {call}=mock();
 assert.equal((await call("GET","/api/analytics/pedidos/agenda",{farmacias:"99"})).status,400);
 assert.equal((await call("POST","/api/analytics/pedidos/agenda/realizados",
  {laboratorio:"P:1",farmacias:[99],fecha:"2026-10-29"})).status,400);
 assert.equal((await call("POST","/api/analytics/pedidos/agenda/realizados",
  {laboratorio:"P:1",farmacias:[1],fecha:"2026-02-29"})).status,400);
 assert.equal((await call("POST","/api/analytics/pedidos/agenda/realizados",
  {laboratorio:"N:CINFA",farmacias:[1],fecha:"2026-10-29"})).status,400);
 assert.equal((await call("DELETE","/api/analytics/pedidos/agenda/realizados/:group",
  {group:"not-uuid"})).status,400);
});
test("registrar pedido preserva grupos y farmacias confirmadas",async()=>{
 const {call,queries}=mock();
 const r=await call("POST","/api/analytics/pedidos/agenda/realizados",
  {laboratorio:"P:10",farmacias:[2,1],fecha:"2026-10-29",tipo:"pedido"});
 assert.equal(r.status,201);assert.deepEqual(r.body.pharmacyIds,[1,2]);
 assert.match(r.body.groupId,/^[0-9a-f-]{36}$/);
 assert.ok(queries.some(q=>String(q.q||"").includes("preparador_pedidos_realizados")));
 const viewer={role:"farmacia",modules:{compras:true}};
 assert.equal((await call("POST","/api/analytics/pedidos/agenda/realizados",
  {laboratorio:"P:10",farmacias:[1],fecha:"2026-10-29"},viewer)).status,403);
});
