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
  if(sql.startsWith("SELECT farmacia_id AS"))return {rows:[
   {pharmacyId:1,days:35},{pharmacyId:2,days:60}
  ]};
  if(sql.includes("INSERT INTO farmetrica.op_politicas_reposicion"))
   return {rows:values[1].map(id=>({pharmacyId:id,days:values[2]}))};
  return {rows:[]};
 }};
 setupTenant(app,pool,{requireUser:()=>{},requireSuperadmin:()=>{}});
 const context={role:"administrador",client:{slug:"ampedia",schema:"ampedia"},
  pharmacies:[{id:"1",name:"Centro"},{id:"2",name:"Norte"}]};
 async function call(method,path,body={}){
  const handler=routes.get(method+" "+path);
  assert.ok(handler,"Route exists: "+method+" "+path);
  let status=200,payload,error;
  const req={context,body,user:{email:"admin@example.org"}};
  const res={status(n){status=n;return this},json(value){payload=value;return this}};
  await handler(req,res,e=>{error=e});
  if(error)throw error;
  return {status,payload};
 }
 return {call,calls,context};
}

test("ajustes lee días de stock solo de farmacias autorizadas",async()=>{
 const {call,calls}=harness();
 const response=await call("get","/api/tenant/stock-objetivo");
 assert.equal(response.status,200);
 assert.deepEqual(response.payload.items.map(p=>p.days),[35,60]);
 assert.deepEqual(calls[0].values,["ampedia",[1,2]]);
 assert.match(calls[0].sql,/cliente_slug=\$1/);
});
test("guardar global cambia solo cobertura, conserva intervalo de pedidos y datos del ERP",async()=>{
 const {call,calls}=harness();
 const response=await call("put","/api/tenant/stock-objetivo",{pharmacyId:0,days:45});
 assert.equal(response.status,200);
 assert.deepEqual(response.payload.updatedPharmacies,[1,2]);
 const sql=calls[0].sql;
 assert.match(sql,/ON CONFLICT\(cliente_slug,farmacia_id\) DO UPDATE/);
 assert.match(sql,/SET cobertura_saludable=EXCLUDED.cobertura_saludable/);
 assert.doesNotMatch(sql,/SET intervalo_pedidos=/);
 assert.deepEqual(calls[0].values,["ampedia",[1,2],45,"admin@example.org"]);
});
test("objetivo por farmacia y validación contra ID ajeno",async()=>{
 const {call,calls}=harness();
 assert.equal((await call("put","/api/tenant/stock-objetivo",{pharmacyId:2,days:14})).status,200);
 assert.deepEqual(calls[0].values[1],[2]);
 assert.equal((await call("put","/api/tenant/stock-objetivo",{pharmacyId:99,days:14})).status,400);
 assert.equal((await call("put","/api/tenant/stock-objetivo",{pharmacyId:0,days:0})).status,400);
 assert.equal((await call("put","/api/tenant/stock-objetivo",{pharmacyId:0,days:10.5})).status,400);
 assert.equal(calls.length,1);
});
