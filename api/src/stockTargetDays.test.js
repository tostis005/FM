import test from "node:test";
import assert from "node:assert/strict";
import {setupTenant} from "./tenant.js";

function harness(){
 const routes=new Map(),calls=[];
 const app=Object.fromEntries(["get","post","put","patch","delete"].map(method=>[
  method,(path,...handlers)=>routes.set(method+" "+path,handlers.at(-1))
 ]));
 const pool={async query(sql,values){
  calls.push({sql,values});
  if(sql.includes("FROM farmetrica.preparador_configuracion_cliente"))
   return {rows:[{days:28}]};
  if(sql.includes("INSERT INTO farmetrica.preparador_configuracion_cliente"))
   return {rows:[{days:values[1]}]};
  return {rows:[]};
 }};
 setupTenant(app,pool,{requireUser:()=>{},requireSuperadmin:()=>{}});
 const context={role:"administrador",client:{slug:"ampedia",schema:"ampedia"},
  pharmacies:[{id:"1",name:"Centro"},{id:"2",name:"Norte"}]};
 async function call(method,path,body={}){
  const handler=routes.get(method+" "+path);assert.ok(handler);
  let status=200,payload,error;
  const req={context,body,user:{email:"admin@example.org"}};
  const res={status(n){status=n;return this},json(value){payload=value;return this}};
  await handler(req,res,e=>{error=e});
  if(error)throw error;
  return {status,payload};
 }
 return {call,calls};
}
test("cobertura compartida de 20 días por defecto y valor único persistido",async()=>{
 const {call,calls}=harness();
 const r=await call("get","/api/tenant/stock-objetivo");
 assert.equal(r.status,200);
 assert.equal(r.payload.days,28);
 assert.equal(r.payload.defaultDays,20);
 assert.deepEqual(calls[0].values,["ampedia"]);
});
test("guardar cobertura global no mezcla frecuencia, plazos ni compras de Farmatic",async()=>{
 const {call,calls}=harness();
 const r=await call("put","/api/tenant/stock-objetivo",{days:20});
 assert.equal(r.status,200);assert.equal(r.payload.days,20);
 assert.match(calls[0].sql,/ON CONFLICT\(cliente_slug\) DO UPDATE/);
 assert.match(calls[0].sql,/cobertura_dias=EXCLUDED.cobertura_dias/);
 assert.doesNotMatch(calls[0].sql,/intervalo_pedidos/);
 assert.deepEqual(calls[0].values,["ampedia",20,"admin@example.org"]);
});
test("rechaza valores inválidos y ya no admite ámbito por farmacia",async()=>{
 const {call,calls}=harness();
 assert.equal((await call("put","/api/tenant/stock-objetivo",{days:0})).status,400);
 assert.equal((await call("put","/api/tenant/stock-objetivo",{days:12.5})).status,400);
 assert.equal((await call("put","/api/tenant/stock-objetivo",{days:999})).status,400);
 assert.equal(calls.length,0);
});
