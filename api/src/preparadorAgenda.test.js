import test from "node:test";
import assert from "node:assert/strict";
import {buildAgenda,civilDays,validOrderDate,demoDueOffset,setupPreparadorAgenda} from "./preparadorAgenda.js";

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
 assert.equal(result[1].demo,true);
 assert.ok(result[1].daysUntil>=0&&result[1].daysUntil<=11);
 assert.equal(result[1].lastOrder,null);
 assert.equal(civilDays("2026-10-29","2026-10-31"),2);
 assert.equal(validOrderDate("2026-02-29"),false);
 assert.equal(validOrderDate("2024-02-29"),true);
});


test("la demo reparte cada día los laboratorios sin fechas entre hoy, mañana y la semana",()=>{
 const rows=Array.from({length:31},(_,i)=>({
  id:String(i+1),name:"Laboratorio "+String(i+1).padStart(2,"0"),
  days:i%3===0?4:i%3===1?7:14,lastOrder:null,cn:200+i
 }));
 for(const today of ["2026-10-29","2026-11-02","2026-11-14","2027-02-01"]){
  const a=buildAgenda(rows,today),b=buildAgenda(rows,today);
  assert.deepEqual(a,b,"misma fecha y catálogo dan el mismo resultado");
  assert.ok(a.filter(x=>x.status==="hoy").length>=2);
  assert.ok(a.filter(x=>x.status==="manana").length>=2);
  assert.ok(a.filter(x=>x.status==="proximo"&&x.daysUntil<=7).length>=10);
  assert.ok(a.every(x=>x.demo&&x.lastOrder===null&&x.daysUntil>=0&&x.daysUntil<=11));
  assert.ok(!a.some(x=>x.status==="vencido"),"sin fechas reales no se crean vencidos");
 }
 assert.equal(demoDueOffset(4,"2026-10-29"),demoDueOffset(4,"2026-10-29"));
 assert.notEqual(demoDueOffset(4,"2026-10-29"),demoDueOffset(4,"2026-10-30"));
});

test("el primer pedido real sustituye la simulación y se calcula el vencimiento auténtico",()=>{
 const today="2026-10-29",base={id:"1117",name:"CINFA",days:4,cn:982};
 const before=buildAgenda([{...base,lastOrder:null}],today)[0];
 assert.equal(before.demo,true);
 const after=buildAgenda([{...base,lastOrder:"2026-10-28"}],today)[0];
 assert.equal(after.demo,false);
 assert.equal(after.lastOrder,"2026-10-28");
 assert.equal(after.nextDue,"2026-11-01");
 assert.equal(after.daysUntil,3);
 assert.equal(after.status,"proximo");
 const late=buildAgenda([{...base,lastOrder:"2026-10-20"}],today)[0];
 assert.equal(late.demo,false);
 assert.equal(late.status,"vencido","los pedidos reales sí pueden vencer");
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
