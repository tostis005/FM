import test from "node:test";
import assert from "node:assert/strict";
import {setupTenantPromotions} from "./promocionesTenant.js";

function create({role="administrador",document={id:"P1",name:"Oferta",cns:["123456"],targets:{"1":8}}}={}){
 const routes=new Map();
 const queries=[],revisions=[];
 const records=new Map(document?[[document.id,document]]:[]);
 let released=false,rollback=false;
 const connection={
  async query(sql,params=[]){
   queries.push({sql,params});
   if(sql==="BEGIN"||sql==="COMMIT")return {rows:[]};
   if(sql==="ROLLBACK"){rollback=true;return {rows:[]};}
   if(sql.includes("DELETE FROM")){
    const old=records.get(params[0]);if(old)records.delete(params[0]);
    return {rows:old?[{documento:old}]:[]};
   }
   if(sql.includes("fm_promocion_revisiones")){
    revisions.push(params);return {rows:[]};
   }
   throw Error("SQL inesperado: "+sql);
  },release(){released=true;}
 };
 const pool={connect:async()=>connection};
 const app={
  get(path,...handlers){routes.set("GET "+path,handlers.at(-1));},
  put(path,...handlers){routes.set("PUT "+path,handlers.at(-1));},
  delete(path,...handlers){routes.set("DELETE "+path,handlers.at(-1));}
 };
 setupTenantPromotions(app,pool,{requireTenantModule:()=>[]});
 async function call(id="P1",override={}){
  const req={params:{id},context:{role,client:{schema:"ampedia"},pharmacies:[{id:"1"}],allowedPharmacyIds:[1]},user:{email:"admin@example.com"},...override};
  let status=200,body,error;
  const res={status(v){status=v;return res;},json(v){body=v;return res;}};
  await routes.get("DELETE /api/tenant/promociones/:id")(req,res,e=>{error=e;});
  if(error)throw error;
  return {status,body};
 }
 return {call,queries,revisions,records,release:()=>released,rolledBack:()=>rollback};
}
test("administrador elimina en la base del cliente y conserva revisión de auditoría",async()=>{
 const ctx=create();
 const result=await ctx.call();
 assert.deepEqual(result,{status:200,body:{id:"P1",deleted:true}});
 assert.equal(ctx.records.size,0);
 assert.equal(ctx.revisions.length,1);
 assert.equal(ctx.revisions[0][0],"P1");
 assert.equal(ctx.revisions[0][2],"admin@example.com");
 assert.deepEqual(JSON.parse(ctx.revisions[0][1]).targets,{"1":8});
 assert.ok(JSON.parse(ctx.revisions[0][1]).deletedAt);
 assert.deepEqual(ctx.queries.map(q=>q.sql==="BEGIN"?"BEGIN":q.sql==="COMMIT"?"COMMIT":q.sql.includes("DELETE FROM")?"DELETE":"AUDIT"),["BEGIN","DELETE","AUDIT","COMMIT"]);
 assert.equal(ctx.release(),true);
});
test("eliminar dos veces es idempotente, la segunda no crea revisiones",async()=>{
 const ctx=create();
 await ctx.call();
 assert.deepEqual((await ctx.call()).body,{id:"P1",deleted:false});
 assert.equal(ctx.revisions.length,1);
});
test("un empleado no puede eliminar promociones ni consultar otras tablas",async()=>{
 const ctx=create({role:"farmacia"});
 const result=await ctx.call();
 assert.equal(result.status,403);
 assert.equal(ctx.records.size,1);
 assert.equal(ctx.queries.length,0);
});
test("no se ejecuta SQL con ID o esquema inválidos",async()=>{
 const ctx=create();
 const result=await ctx.call("../P1");
 assert.equal(result.status,400);
 assert.equal(ctx.records.size,1);
 // El ID es un valor paramétrico; no permite extraer otro cliente.
 const ctx2=create();
 const response=await ctx2.call("P1",{context:{role:"administrador",client:{schema:'ampedia";DROP SCHEMA x;--'}}});
 assert.equal(response.status,400);
 assert.equal(ctx2.queries.length,0);
});
