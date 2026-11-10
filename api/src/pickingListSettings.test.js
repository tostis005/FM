import test from "node:test";
import assert from "node:assert/strict";
import {setupPickingList} from "./pickingList.js";

const current="https://www.dropbox.com/scl/fi/abc-123/pedidospendientes.csv?rlkey=original&dl=1";
function fixture(){
 const routes=new Map(),queries=[];
 let url=current;
 const app={
  get(path,...handlers){routes.set("GET "+path,handlers)},
  put(path,...handlers){routes.set("PUT "+path,handlers)},
  post(path,...handlers){routes.set("POST "+path,handlers)}
 };
 const pool={async query(sql,params){
  queries.push({sql,params});
  if(sql.includes("SELECT csv_url,ultima_importacion")){
   return {rows:[{csv_url:url,lastImportedAt:"2026-11-10T10:00:00Z",
    updatedAt:"2026-11-10T09:00:00Z"}]};
  }
  if(sql.includes("INSERT INTO farmetrica.picking_list_fuentes")&&sql.includes("csv_url=EXCLUDED.csv_url")){
   url=params[1];
   return {rows:[]};
  }
  throw Error("SQL inesperado: "+sql);
 }};
 setupPickingList(app,pool,{requireTenant:()=>[]});
 async function call(method,path,role,body={}){
  const handlers=routes.get(method+" "+path);assert.ok(handlers);
  const req={context:{client:{slug:"ampedia"},role,modules:{stock:true},
   profilePermissions:{stock:["ver","importar"]}},user:{email:"test@example.invalid"},body};
  let status=200,response;
  const res={status(n){status=n;return res},json(v){response=v;return res}};
  for(const handler of handlers){
   let proceed=false,thrown;
   await handler(req,res,err=>{if(err)thrown=err;else proceed=true});
   if(thrown)throw thrown;
   if(!proceed)break;
  }
  return {status,response};
 }
 return {call,queries,getUrl:()=>url};
}

test("El Dropbox actual se recupera desde Ajustes, sin sobrescribir su ruta",async()=>{
 const {call,queries,getUrl}=fixture();
 const res=await call("GET","/api/picking-list/source","gestor");
 assert.equal(res.status,200);
 assert.equal(res.response.url,current);
 assert.equal(res.response.sourceConfigured,true);
 assert.equal(getUrl(),current);
 assert.equal(queries.filter(q=>q.sql.includes("INSERT")).length,0);
 assert.equal((await call("GET","/api/picking-list/source","administrador")).status,200);
});
test("Solo gestores o administradores pueden consultar/cambiar el enlace",async()=>{
 const {call,queries,getUrl}=fixture();
 assert.equal((await call("GET","/api/picking-list/source","farmacia")).status,403);
 assert.equal((await call("PUT","/api/picking-list/source","farmacia",{url:current})).status,403);
 assert.equal(queries.length,0);
 assert.equal(getUrl(),current);
});
test("Actualizar el origen únicamente en Ajustes conserva el nuevo enlace para siguientes visitas",async()=>{
 const {call,getUrl}=fixture();
 const changed="https://www.dropbox.com/scl/fi/new456/pedidospendientes.csv?rlkey=newkey&dl=0";
 const updated=await call("PUT","/api/picking-list/source","gestor",{url:changed});
 assert.equal(updated.status,200);
 assert.match(getUrl(),/rlkey=newkey&dl=1/);
 const read=await call("GET","/api/picking-list/source","gestor");
 assert.equal(read.response.url,getUrl());
});
