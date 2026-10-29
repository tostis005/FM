import test from "node:test";
import assert from "node:assert/strict";
import {buildAgenda,civilDays,validOrderDate,setupPreparadorAgenda} from "./preparadorAgenda.js";

test("agenda global: un único vencimiento por laboratorio, sin dividir farmacias",()=>{
 const result=buildAgenda([
  {id:"10",name:"Cinfa",days:4,lastOrder:"2026-10-20",cn:2705},
  {id:"20",name:"Isdin",days:14,lastOrder:null,cn:361}
 ],"2026-10-29");
 assert.equal(result.length,2);
 assert.equal(result[0].key,"P:10");
 assert.equal(result[0].status,"vencido");
 assert.equal(result[0].nextDue,"2026-10-24");
 assert.equal(result[0].cn,2705);
 assert.equal(result[0].overdue,1);
 assert.equal(result[1].withoutDate,1);
 assert.equal(result[1].status,"hoy");
 assert.equal(result[1].provisional,true);
 assert.equal(result[1].nextDue,"2026-10-29");
 assert.equal(civilDays("2026-10-29","2026-10-31"),2);
 assert.equal(validOrderDate("2026-02-29"),false);
 assert.equal(validOrderDate("2024-02-29"),true);
});

test("vista demo: siempre reparte 31 laboratorios entre hoy, mañana y próximos días",()=>{
 const pending=Array.from({length:31},(_,i)=>({
  id:String(i+1),name:"Laboratorio "+(i+1),days:i%3===0?4:14,
  lastOrder:null,cn:31-i
 }));
 const first=buildAgenda(pending,"2026-10-29");
 const second=buildAgenda(pending,"2026-11-10");
 assert.equal(first.length,31);
 assert.equal(first.filter(x=>x.status==="vencido").length,0);
 assert.equal(first.filter(x=>x.status==="hoy").length,4);
 assert.equal(first.filter(x=>x.status==="manana").length,4);
 assert.equal(first.filter(x=>x.status==="proximo").length,23);
 assert.equal(first.every(x=>x.provisional&&x.withoutDate===1&&x.lastOrder===null),true);
 assert.equal(second.filter(x=>x.status==="vencido").length,0);
 assert.deepEqual(first.map(x=>x.key),second.map(x=>x.key));
 assert.ok(second.every(x=>x.daysUntil>=0&&x.daysUntil<=7));
});
test("primer pedido real sustituye demo y sí genera vencidos de verdad",()=>{
 const base=[{id:"1117",name:"CINFA",days:4,cn:982,lastOrder:null}];
 const demo=buildAgenda(base,"2026-10-29")[0];
 assert.equal(demo.provisional,true);
 assert.equal(demo.status,"hoy");
 const real=buildAgenda([{...base[0],lastOrder:"2026-10-20"}],"2026-10-29")[0];
 assert.equal(real.provisional,false);
 assert.equal(real.status,"vencido");
 assert.equal(real.nextDue,"2026-10-24");
 assert.equal(real.withoutDate,0);
 const reset=buildAgenda([{...base[0],lastOrder:"2026-10-29"}],"2026-10-29")[0];
 assert.equal(reset.status,"proximo");
 assert.equal(reset.daysUntil,4);
});

function mock(){
 const routes={},queries=[];
 const app={get(path,...handlers){routes["GET "+path]=handlers.at(-1)},
  post(path,...handlers){routes["POST "+path]=handlers.at(-1)},
  delete(path,...handlers){routes["DELETE "+path]=handlers.at(-1)}};
 const pool={query:async(q)=>{queries.push({q});if(String(q).includes("RETURNING grupo_id::text"))return {rows:[{groupId:"ok"}]};return {rows:[]}},
  connect:async()=>({query:async(q,values)=>{queries.push({q,values});
   if(String(q).includes('RETURNING grupo_id::text AS "groupId"'))return {rows:[{groupId:"generated"}]};
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
test("la fecha global no admite laboratorios ajenos ni fechas inválidas",async()=>{
 const {call}=mock();
 assert.equal((await call("POST","/api/analytics/pedidos/agenda/realizados",
  {laboratorio:"P:1",fecha:"2026-02-29"})).status,400);
 assert.equal((await call("POST","/api/analytics/pedidos/agenda/realizados",
  {laboratorio:"N:CINFA",fecha:"2026-10-29"})).status,400);
 assert.equal((await call("DELETE","/api/analytics/pedidos/agenda/realizados/:group",
  {group:"not-uuid"})).status,400);
});
test("registrar pedido global crea una única confirmación del laboratorio",async()=>{
 const {call,queries}=mock();
 const r=await call("POST","/api/analytics/pedidos/agenda/realizados",
  {laboratorio:"P:10",fecha:"2026-10-29",tipo:"pedido"});
 assert.equal(r.status,201);
 assert.equal(r.body.scope,"global");
 assert.match(r.body.groupId,/^[0-9a-f-]{36}$/);
 assert.ok(queries.some(q=>String(q.q||"").includes("preparador_pedidos_globales")));
 assert.ok(queries.some(q=>String(q.q||"").includes("INSERT INTO farmetrica.preparador_pedidos_globales")));
 assert.ok(!queries.some(q=>String(q.q||"").includes("INSERT INTO farmetrica.preparador_pedidos_realizados")));
 const viewer={role:"farmacia",modules:{compras:true}};
 assert.equal((await call("POST","/api/analytics/pedidos/agenda/realizados",
  {laboratorio:"P:10",fecha:"2026-10-29"},viewer)).status,403);
});
test("las lecturas de agenda no hacen join ni filtro por farmacia",async()=>{
 const {call,queries}=mock();
 const r=await call("GET","/api/analytics/pedidos/agenda");
 assert.equal(r.status,200);
 const sql=queries.map(x=>x.q?.text||x.q||"").join("\n");
 assert.ok(sql.includes("preparador_pedidos_globales"));
 assert.ok(!sql.includes("f.id=ANY"));
});
