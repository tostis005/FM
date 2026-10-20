import test from "node:test";
import assert from "node:assert/strict";
import {setupTenantPromotions} from "./promocionesTenant.js";
const fields={laboratory:"LAB",range:"Gama",originalOffer:"3X2",description:"Descripción",
 start:"2026-10-01",end:"2026-10-31",cns:["123456"],targets:{"1":8},name:"Gama · 3X2",status:"Activa",sales:{}};
const old={...fields,id:"OLD",source:"Excel anterior"};
const next={...fields,id:"NEW",range:"Gama nueva",source:"Excel nuevo"};
function setup({role="administrador",previous=[old],failInsert=false,failRevision=false}={}){
 const routes=new Map(),log=[],revisions=[];
 let records=new Map(previous.map(p=>[p.id,p])),snapshot=null;
 const db={
  async query(sql,params=[]){
   log.push({sql,params});
   if(sql==="BEGIN"){snapshot=new Map(records);return {rows:[]};}
   if(sql==="COMMIT"){snapshot=null;return {rows:[]};}
   if(sql==="ROLLBACK"){records=snapshot;return {rows:[]};}
   if(sql.includes("pg_advisory_xact_lock"))return {rows:[]};
   if(sql.includes("SELECT id,documento")&&sql.includes("FOR UPDATE"))
    return {rows:[...records].map(([id,documento])=>({id,documento}))};
   if(sql.includes("SELECT documento FROM")&&sql.includes("ORDER BY"))
    return {rows:[...records.values()].map(documento=>({documento}))};
   if(sql.includes("DELETE FROM")&&sql.includes("RETURNING id,documento")){
    const gone=[];
    for(const id of params[0]||[]){
     if(records.has(id)){gone.push({id,documento:records.get(id)});records.delete(id);}
    }
    return {rows:gone};
   }
   if(sql.includes("INSERT INTO")&&sql.includes("fm_promociones")&&!sql.includes("revisiones")){
    if(failInsert)throw Error("Fallo escritura");
    const promo=JSON.parse(params[1]);if(records.has(promo.id))throw Error("ID ya existente");
    records.set(promo.id,promo);return {rows:[]};
   }
   if(sql.includes("fm_promocion_revisiones")){
    if(failRevision)throw Error("Fallo auditoría");
    revisions.push(params);return {rows:[]};
   }
   throw Error("SQL inesperado: "+sql);
  },release(){}
 };
 const pool={connect:async()=>db,query:(...args)=>db.query(...args)};
 const app={
  get(path,...f){routes.set("GET "+path,f.at(-1))},
  post(path,...f){routes.set("POST "+path,f.at(-1))},
  put(path,...f){routes.set("PUT "+path,f.at(-1))},
  delete(path,...f){routes.set("DELETE "+path,f.at(-1))}
 };
 setupTenantPromotions(app,pool,{requireTenantModule:()=>[]});
 async function call(path,body={}){
  const req={body,context:{role,client:{schema:"ampedia"},
   pharmacies:[{id:"1"}],allowedPharmacyIds:[1]},user:{email:"qa@example.org"}};
  let status=200,payload,error;
  const res={status(v){status=v;return res},json(v){payload=v;return res}};
  await routes.get("POST "+path)(req,res,e=>{error=e});
  return {status,payload,error};
 }
 return {call,records:()=>records,log,revisions};
}
test("la antigua sustitución completa queda desactivada",async()=>{
 const t=setup(),r=await t.call("/api/tenant/promociones/reemplazar",{promotions:[next]});
 assert.equal(r.status,410);assert.deepEqual([...t.records().keys()],["OLD"]);
});
test("importa añadidos y conserva íntegra la promoción existente",async()=>{
 const t=setup();
 const same={...old,id:"SAME",targets:{"1":200},cns:["999999"],sourceRow:9};
 const path="/api/tenant/promociones/importar";
 const first=await t.call(path,{promotions:[same,next]});
 assert.equal(first.status,200);assert.deepEqual([first.payload.imported,first.payload.skipped],[1,1]);
 assert.equal(t.records().get("OLD").targets["1"],8);
 assert.equal(t.records().get("OLD").cns[0],"123456");
 assert.equal(t.records().get("NEW").range,"Gama nueva");
 const again=await t.call(path,{promotions:[same,next]});
 assert.deepEqual([again.payload.imported,again.payload.skipped],[0,2]);
 assert.equal(t.records().size,2);
 assert.equal(t.revisions.length,0);
});
test("otro año mantiene ambas campañas y los IDs que colisionan se desambiguan",async()=>{
 const t=setup();
 const alt={...old,start:"2027-10-01",end:"2027-10-31"};
 const r=await t.call("/api/tenant/promociones/importar",{promotions:[alt]});
 assert.equal(r.payload.imported,1);
 assert.ok(t.records().has("OLD-1"));
});
test("un fallo al insertar revierte todo el lote, sin perder originales",async()=>{
 const t=setup({failInsert:true});
 const r=await t.call("/api/tenant/promociones/importar",{promotions:[next]});
 assert.match(r.error.message,/Fallo escritura/);
 assert.deepEqual([...t.records().keys()],["OLD"]);
 assert.equal(t.log.at(-1).sql,"ROLLBACK");
});
test("la eliminación múltiple archiva y borra solo IDs seleccionados, en un commit",async()=>{
 const t=setup({previous:[old,next,{...old,id:"THIRD",range:"Tercera"}]});
 const r=await t.call("/api/tenant/promociones/eliminar-lote",{ids:["OLD","NEW"]});
 assert.equal(r.status,200);
 assert.deepEqual(new Set(r.payload.deletedIds),new Set(["OLD","NEW"]));
 assert.deepEqual([...t.records().keys()],["THIRD"]);
 assert.equal(t.revisions.length,2);
 assert.ok(t.revisions.every(item=>JSON.parse(item[1]).deletedAt));
 assert.equal(t.log.at(-1).sql,"COMMIT");
});
test("un error de auditoría revierte también todas las eliminaciones",async()=>{
 const t=setup({previous:[old,next],failRevision:true});
 const r=await t.call("/api/tenant/promociones/eliminar-lote",{ids:["OLD","NEW"]});
 assert.match(r.error.message,/Fallo auditoría/);
 assert.equal(t.records().size,2);assert.equal(t.log.at(-1).sql,"ROLLBACK");
});
test("sin permisos o con IDs repetidos no se modifican las promociones",async()=>{
 const t=setup({role:"farmacia"});
 assert.equal((await t.call("/api/tenant/promociones/importar",{promotions:[next]})).status,403);
 assert.equal((await t.call("/api/tenant/promociones/eliminar-lote",{ids:["OLD"]})).status,403);
 const admin=setup();
 assert.equal((await admin.call("/api/tenant/promociones/eliminar-lote",{ids:["OLD","OLD"]})).status,400);
 assert.equal((await admin.call("/api/tenant/promociones/eliminar-lote",{ids:[]})).status,400);
 assert.deepEqual([...admin.records().keys()],["OLD"]);
});
