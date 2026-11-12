import test from "node:test";
import assert from "node:assert/strict";
import {setupProfiles} from "./perfiles.js";

test("el editor recibe exclusivamente módulos habilitados del cliente, incluso para superadmin",async()=>{
 const handlers=new Map(),calls=[];
 const app={
  get(path,...handlersForRoute){handlers.set(path,handlersForRoute.at(-1))},
  post(){},put(){},delete(){}
 };
 const pool={async query(query,params=[]){
  const sql=String(query);calls.push({sql,params});
  if(sql.includes("FROM farmetrica.perfiles p"))return {rows:[]};
  if(sql.includes("FROM farmetrica.modulos ORDER BY nombre"))return {rows:[
   {id:"ventas",name:"Ventas"},{id:"compras",name:"Compras"},
   {id:"stock",name:"Stock"}]};
  if(sql.includes("FROM farmetrica.cliente_modulos"))return {rows:[
   {id:"ventas"},{id:"stock"}]};
  throw Error("Consulta inesperada: "+sql);
 }};
 setupProfiles(app,pool,{requireTenantManager:()=>[],requireSuperadmin:()=>{}});
 const check=async(path,req)=>{
  const res={json(payload){this.payload=payload;return this}};
  await handlers.get(path)(req,res,error=>{if(error)throw error});
  assert.deepEqual(res.payload.enabledModuleIds,["ventas","stock"]);
  assert.ok(res.payload.modules.some(module=>module.id==="compras"),
   "el catálogo completo se conserva para no perder permisos históricos");
  assert.ok(res.payload.sections.some(section=>section.id==="compras-preparador"));
 };
 await check("/api/tenant/perfiles/gestion",{
  context:{role:"administrador",client:{slug:"cliente1"},
   modules:{ventas:true,compras:false,stock:true},
   sections:{ventas:true,stock:true},profilePermissions:null}
 });
 await check("/api/admin/perfiles",{
  user:{role:"superadministrador"},get(name){
   return name==="x-farmetrica-cliente"?"cliente2":undefined;
  }
 });
 const slugs=calls.filter(call=>call.sql.includes("FROM farmetrica.cliente_modulos"))
  .map(call=>call.params[0]);
 assert.deepEqual(slugs,["cliente1","cliente2"]);
});
