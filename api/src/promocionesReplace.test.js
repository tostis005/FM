import test from "node:test";
import assert from "node:assert/strict";
import {setupTenantPromotions} from "./promocionesTenant.js";

const oldPromo={id:"OLD",name:"Oferta antigua",status:"Activa",
 cns:["111111"],targets:{"1":5},sales:{}};
const goodPromo={id:"NEW",name:"Oferta del Excel",status:"Activa",
 cns:["222222"],targets:{"1":10,"2":""},sales:{},source:"Excel"};
function setup({role="administrador",old=[oldPromo],failInsert=false}={}){
 const routes=new Map(),logs=[],revisions=[];
 let records=new Map(old.map(p=>[p.id,p])),snapshot=null;
 const db={
  async query(sql,params=[]){
   logs.push({sql,params});
   if(sql==="BEGIN"){snapshot=new Map(records);return {rows:[]};}
   if(sql==="COMMIT"){snapshot=null;return {rows:[]};}
   if(sql==="ROLLBACK"){records=snapshot||records;return {rows:[]};}
   if(sql.includes("SELECT id,documento")&&sql.includes("FOR UPDATE"))
    return {rows:[...records.values()].map(p=>({id:p.id,documento:p}))};
   if(sql.includes("fm_promocion_revisiones")){revisions.push(params);return {rows:[]};}
   if(sql.includes("DELETE FROM")){records.clear();return {rows:[]};}
   if(sql.includes("INSERT INTO")&&sql.includes(".fm_promociones")){
    if(failInsert)throw Error("Fallo de escritura simulada");
    const p=JSON.parse(params[1]);records.set(p.id,p);return {rows:[]};
   }
   throw Error("SQL inesperado: "+sql);
  },release(){}
 };
 const app={
  get(path,...f){routes.set("GET "+path,f.at(-1));},
  put(path,...f){routes.set("PUT "+path,f.at(-1));},
  post(path,...f){routes.set("POST "+path,f.at(-1));},
  delete(path,...f){routes.set("DELETE "+path,f.at(-1));}
 };
 setupTenantPromotions(app,{connect:async()=>db},{requireTenantModule:()=>[]});
 async function call(promotions=[goodPromo]){
  const req={context:{role,client:{schema:"ampedia"},
   pharmacies:[{id:"1"},{id:"2"}]},user:{email:"administrador@example.org"},
   body:{promotions}};
  let status=200,body,error;
  const res={status(n){status=n;return res;},json(b){body=b;return res;}};
  await routes.get("POST /api/tenant/promociones/reemplazar")(req,res,e=>{error=e;});
  return {status,body,error};
 }
 return {call,records:()=>records,revisions,logs};
}
test("importar sustituye TODAS las promociones y preserva respaldo auditable",async()=>{
 const t=setup({old:[oldPromo,{...oldPromo,id:"OLD2"}]});
 const r=await t.call();
 assert.deepEqual(r.body,{removed:2,imported:1});
 assert.deepEqual([...t.records().keys()],["NEW"]);
 assert.equal(t.revisions.length,2);
 for(const record of t.revisions){
  const old=JSON.parse(record[1]);
  assert.equal(old.deletedReason,"Reimportación completa de promociones");
  assert.ok(old.deletedAt);
 }
 assert.equal(t.logs[0].sql,"BEGIN");
 assert.equal(t.logs.at(-1).sql,"COMMIT");
});
test("cualquier error de inserción revierte el borrado de todas las originales",async()=>{
 const t=setup({failInsert:true});
 const r=await t.call();
 assert.match(r.error.message,/Fallo de escritura/);
 assert.deepEqual([...t.records().keys()],["OLD"]);
 assert.equal(t.logs.at(-1).sql,"ROLLBACK");
});
test("no se sustituyen promociones sin permiso o con objetivos de farmacias ajenas",async()=>{
 const no=setup({role:"farmacia"});
 assert.equal((await no.call()).status,403);
 assert.deepEqual([...no.records().keys()],["OLD"]);
 const invalid=setup();
 assert.equal((await invalid.call([{...goodPromo,targets:{"9":2}}])).status,400);
 assert.equal(invalid.logs.length,0);
 assert.equal((await invalid.call([goodPromo,goodPromo])).status,400);
 assert.equal(invalid.logs.length,0);
});
