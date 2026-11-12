import test from "node:test";
import assert from "node:assert/strict";
import {setupTransferidorPolicy,stockPolicyFromRows} from "./transferidorPolicy.js";

const setup=()=>{
 const routes=new Map(),calls=[];
 const app=Object.fromEntries(["get","put","delete"].map(method=>[
  method,(path,...stack)=>routes.set(method+" "+path,stack.at(-1))
 ]));
 const pool={async query(sql,values){
  const text=typeof sql==="string"?sql:sql.text;
  calls.push({text,values:typeof sql==="string"?values:sql.values});
  if(text.includes("FROM farmetrica.transferidor_configuracion_cliente"))
   return {rows:[{minDays:4,targetDays:7}]};
  if(text.includes("FROM farmetrica.transferidor_exposicion_familias"))
   return {rows:[]};
  if(text.includes("FROM farmetrica.transferidor_exposicion_articulos"))
   return {rows:[]};
  if(text.includes("INSERT INTO farmetrica.transferidor_exposicion_familias"))
   return {rows:values[2].includes("999")?[]:values[2].map(id=>({familia_id:id}))};
  if(text.includes("INSERT INTO farmetrica.transferidor_exposicion_articulos"))
   return {rows:[{farmacia_id:1}]};
  if(text.includes("DELETE FROM farmetrica.transferidor_exposicion_familias"))
   return {rowCount:values[2].length,rows:[]};
  return {rows:[],rowCount:1};
 }};
 setupTransferidorPolicy(app,pool,{requireTenantManager:()=>[]});
 const context={client:{slug:"ampedia",schema:"ampedia"},
  pharmacies:[{id:"1",name:"Abadía",active:true}]};
 async function call(method,path,body={}){
  let status=200,result,error;
  const handler=routes.get(method+" "+path);assert.ok(handler,"Falta "+method+" "+path);
  const res={status(n){status=n;return this},json(r){result=r;return this}};
  await handler({context,user:{email:"admin@example.org"},body},res,e=>{error=e});
  if(error)throw error;
  return {status,result};
 }
 return {call,calls};
};
test("política global 4/7 independiente de preparador de 30 días",async()=>{
 assert.deepEqual(stockPolicyFromRows(),{minDays:4,targetDays:7,families:[],articles:[]});
 const {call,calls}=setup();
 const read=await call("get","/api/tenant/transferidor-politica");
 assert.equal(read.result.minDays,4);
 assert.equal(read.result.targetDays,7);
 assert.ok(calls.every(x=>!x.text.includes("preparador_configuracion_cliente")));
});
test("guarda los umbrales y rechaza objetivos menores o iguales",async()=>{
 const {call}=setup();
 assert.equal((await call("put","/api/tenant/transferidor-politica",{minDays:7,targetDays:7})).status,400);
 assert.equal((await call("put","/api/tenant/transferidor-politica",{minDays:4,targetDays:7})).status,200);
});
test("farmacia no autorizada no puede asignar exposición",async()=>{
 const {call,calls}=setup();
 const r=await call("put","/api/tenant/transferidor-politica/familias",{pharmacyId:"2",familyId:"8",days:30});
 assert.equal(r.status,403);
 assert.equal(calls.length,0);
});
test("30 días de familia y 100 unidades de CN se almacenan por separado",async()=>{
 const {call,calls}=setup();
 assert.equal((await call("put","/api/tenant/transferidor-politica/familias",
  {pharmacyId:"1",familyId:"5",days:30})).status,200);
 assert.equal((await call("put","/api/tenant/transferidor-politica/articulos",
  {pharmacyId:"1",cn:"151130",units:100})).status,200);
 assert.ok(calls.some(x=>x.text.includes("transferidor_exposicion_familias")&&x.values[3]===30));
 assert.ok(calls.some(x=>x.text.includes("transferidor_exposicion_articulos")&&x.values[3]===100));
});

test("un mismo nombre de familia admite ramas mixtas y se guarda de forma atómica",async()=>{
 const {call,calls}=setup();
 const payload={pharmacyId:"1",familyId:"5",familyIds:["5","8","9"],days:30};
 const saved=await call("put","/api/tenant/transferidor-politica/familias",payload);
 assert.equal(saved.status,200);
 assert.equal(saved.result.updated,3);
 const insert=calls.find(x=>x.text.includes("INSERT INTO farmetrica.transferidor_exposicion_familias"));
 assert.deepEqual(insert.values[2],["5","8","9"]);
 assert.ok(!insert.text.includes("g.segmento"),"La clasificación no limita la exposición");
 assert.match(insert.text,/cardinality/,"no debe guardar una selección incompleta");
 const deleted=await call("delete","/api/tenant/transferidor-politica/familias",payload);
 assert.equal(deleted.status,200);
 assert.equal(deleted.result.deleted,3);
 assert.deepEqual(calls.at(-1).values[2],["5","8","9"]);
});
test("no admite selecciones vacías o IDs inexistentes, sin aplicar parcialmente",async()=>{
 const {call,calls}=setup();
 const url="/api/tenant/transferidor-politica/familias";
 assert.equal((await call("put",url,{pharmacyId:"1",familyIds:[],days:30})).status,400);
 assert.equal((await call("put",url,{pharmacyId:"1",familyId:"5",familyIds:["5","x"],days:30})).status,400);
 assert.equal((await call("put",url,{pharmacyId:"1",familyId:"5",familyIds:["8"],days:30})).status,400);
 assert.equal((await call("put",url,{pharmacyId:"1",familyId:"5",familyIds:["5","999"],days:30})).status,404);
 assert.ok(calls.filter(x=>x.text.includes("INSERT INTO farmetrica.transferidor_exposicion_familias")).length===1);
});
