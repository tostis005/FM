import test from "node:test";
import assert from "node:assert/strict";
import {setupTenantPromotions,cleanDocument,visiblePromos,promotionActivationIssues} from "./promocionesTenant.js";

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
   if(sql.includes("SELECT documento,creado_por FROM")&&sql.includes("FOR UPDATE")){
    const old=records.get(params[0]);return {rows:old?[{documento:old,creado_por:"admin@example.com"}]:[]};
   }
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
  post(path,...handlers){routes.set("POST "+path,handlers.at(-1));},
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
 assert.deepEqual(ctx.queries.map(q=>q.sql==="BEGIN"?"BEGIN":q.sql==="COMMIT"?"COMMIT":q.sql.includes("DELETE FROM")?"DELETE":q.sql.includes("SELECT documento")?"SELECT":"AUDIT"),["BEGIN","SELECT","DELETE","AUDIT","COMMIT"]);
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
 const result=await ctx.call("");
 assert.equal(result.status,400);
 assert.equal(ctx.records.size,1);
 // El ID es un valor paramétrico; no permite extraer otro cliente.
 const ctx2=create();
 const response=await ctx2.call("P1",{context:{role:"administrador",client:{schema:'ampedia";DROP SCHEMA x;--'}}});
 assert.equal(response.status,400);
 assert.equal(ctx2.queries.length,0);
});

test("gestor elimina promociones de sus farmacias, sin permisos globales",async()=>{
 const allowed=create({role:"gestor"});
 assert.equal((await allowed.call()).status,200);
 const denied=create({role:"gestor",document:{id:"P1",name:"Campaña ajena",cns:["123456"],targets:{"2":7}}});
 const response=await denied.call();
 assert.equal(response.status,403);
 assert.equal(denied.records.size,1);
 assert.equal(denied.rolledBack(),true);
});

test("la API distingue campañas por fechas y hasta agotar stock",()=>{
 const ids=new Set(["1"]);
 const base={id:"P-CAMP-1",name:"Prueba stock",cns:["123456"],targets:{"1":10},
  start:"2026-11-06",end:"",status:"Borrador",durationMode:"stock"};
 const stock=cleanDocument(base,base.id,ids);
 assert.equal(stock?.durationMode,"stock");
 assert.equal(stock?.end,"");
 assert.deepEqual(stock?.targets,{"1":10});
 assert.equal(cleanDocument({...base,end:"2026-12-01"},base.id,ids),null,
  "No permitir fecha final oculta en campañas de stock");
 const dates={...base,durationMode:"dates",end:"2026-12-01"};
 assert.equal(cleanDocument(dates,dates.id,ids)?.end,"2026-12-01");
 assert.equal(cleanDocument({...dates,end:""},dates.id,ids),null);
 assert.equal(cleanDocument({...dates,end:"2026-11-01"},dates.id,ids),null);
 assert.equal(cleanDocument({...base,durationMode:"stock",retroactive:true},base.id,ids),null);
 assert.equal(cleanDocument({...base,durationMode:"desconocida"},base.id,ids),null);
 // No romper documentos históricos del Excel sin duración explícita.
 const {durationMode:_ignore,...legacy}=base;
 assert.ok(cleanDocument(legacy,legacy.id,ids));
 const excelIncomplete={...base,durationMode:"dates",source:"Excel: archivo.xlsx",start:"",end:""};
 assert.ok(cleanDocument(excelIncomplete,excelIncomplete.id,ids),
  "No bloquear la importación de una ficha Excel incompleta");
});

test("API: empleadas de farmacia ven una campaña publicada de fecha FUTURA, nunca un borrador",()=>{
 const future={id:"F",name:"Diciembre",status:"Activa",statusSource:"manual",
  start:"2026-12-01",end:"2026-12-31",targets:{"1":10},cns:["123456"]};
 const draft={...future,id:"D",status:"Borrador"};
 const other={...future,id:"OTHER",targets:{"2":5}};
 const archived={...future,id:"ARCH",status:"Finalizada"};
 const rows=[future,draft,other,archived].map(documento=>({documento,creado_por:"farmacia@example.com"}));
 const request=role=>({context:{role,allowedPharmacyIds:[1]},user:{email:"farmacia@example.com"}});
 const regular=visiblePromos(rows,request("farmacia"));
 assert.deepEqual(regular.map(p=>p.id),["F","ARCH"]);
 assert.deepEqual(visiblePromos(rows,request("colaborador")).map(p=>p.id),["F","ARCH"]);
 assert.deepEqual(visiblePromos(rows,request("gestor")).map(p=>p.id),["F","D","OTHER","ARCH"],
  "El creador gestor puede ver sus propios borradores incluso sin ámbito actual");
 assert.deepEqual(visiblePromos(rows,request("administrador")).map(p=>p.id),
  ["F","D","OTHER","ARCH"]);
});
test("API: gestor ve borradores de sus farmacias, pero no los de otra farmacia ajena",()=>{
 const base={id:"P1",status:"Borrador",targets:{"1":5},cns:["123456"]};
 const rows=[{documento:base,creado_por:"otro@example.com"},
  {documento:{...base,id:"P2",targets:{"2":5}},creado_por:"otro@example.com"},
  {documento:{...base,id:"P3",targets:{}},creado_por:"gestor@example.com"}];
 const req={context:{role:"gestor",allowedPharmacyIds:[1]},
  user:{email:"gestor@example.com"}};
 assert.deepEqual(visiblePromos(rows,req).map(p=>p.id),["P1","P3"]);
});

test("API guarda objetivos por mes y rechaza farmacias o meses fuera de la vigencia",()=>{
 const ids=new Set(["1","2"]);
 const campaign={id:"M",name:"Objetivos por mes",start:"2026-10-01",end:"2026-12-15",
  durationMode:"dates",status:"Activa",cns:["123456"],targets:{"1":125,"2":20},
  monthlyObjectives:{
   "2026-11":{targets:{"1":125,"2":20},objectiveBaseline:"previous",
    objectiveRates:{"1":10,"2":5}},
   "2026-12":{targets:{"1":80},objectiveBaseline:"year",objectiveRates:{"1":8}}
  }};
 const stored=cleanDocument(campaign,campaign.id,ids);
 assert.deepEqual(stored?.monthlyObjectives,campaign.monthlyObjectives);
 assert.deepEqual(stored?.targets,campaign.targets);
 assert.equal(cleanDocument({...campaign,monthlyObjectives:{"2027-01":{targets:{"1":5}}}},
  campaign.id,ids),null);
 assert.equal(cleanDocument({...campaign,monthlyObjectives:{"2026-11":{targets:{"3":5}}}},
  campaign.id,ids),null);
 assert.equal(cleanDocument({...campaign,monthlyObjectives:{"2026-11":{targets:{"1":-2}}}},
  campaign.id,ids),null);
 const rows=[{documento:campaign,creado_por:"admin@example.com"}];
 const restricted=visiblePromos(rows,{context:{role:"farmacia",allowedPharmacyIds:[1]},
  user:{email:"employee@example.com"}});
 assert.deepEqual(restricted[0].monthlyObjectives["2026-11"].targets,{"1":125});
 assert.deepEqual(restricted[0].monthlyObjectives["2026-11"].objectiveRates,{"1":10});
 assert.deepEqual(restricted[0].monthlyObjectives["2026-12"].targets,{"1":80});
 assert.deepEqual(restricted[0].targets,{"1":125});
});

test("activar con objetivos de noviembre permite diciembre sin configurar y sin objetivos generales rellenados",()=>{
 const campaign={id:"PRUEBA2",name:"prueba 2",status:"Borrador",start:"2026-11-01",end:"2026-12-31",
  type:"descuento_porcentaje",discountPercent:20,cns:["123456"],durationMode:"dates",
  targets:{"1":"","2":""},monthlyObjectives:{"2026-11":{targets:{"1":120,"2":0}}}};
 assert.deepEqual(promotionActivationIssues(campaign),[],
  "Una campaña mensual guardada no necesita objetivos generales duplicados ni metas en diciembre");
 assert.deepEqual(promotionActivationIssues({...campaign,monthlyObjectives:{"2026-12":{targets:{"1":0}}}}),
  ["no hay ningún mes con un objetivo guardado mayor que cero"]);
 const future={...campaign,start:"2026-12-01",end:"2027-01-31",
  monthlyObjectives:{"2026-12":{targets:{"1":8}}}};
 assert.deepEqual(promotionActivationIssues(future),[],
  "Se pueden publicar campañas que empiezan después del mes actual");
});
test("activación masiva informa de cada campo concreto en vez de un error genérico",()=>{
 const base={name:"prueba 2",status:"Borrador",start:"2026-11-01",end:"2026-12-31",
  cns:["123456"],targets:{"1":8},durationMode:"dates",type:"descuento_porcentaje"};
 assert.deepEqual(promotionActivationIssues(base),["falta un porcentaje de descuento válido (1–100 %)"]);
 assert.deepEqual(promotionActivationIssues({...base,discountPercent:20,targets:{"1":""}}),
  ["hay objetivos generales vacíos o con unidades inválidas","no hay ningún objetivo mayor que cero"]);
 assert.deepEqual(promotionActivationIssues({...base,discountPercent:20,targets:{"1":8},
   type:"sin_clasificar",cns:[],start:"",end:""}),
  ["falta una fecha de inicio válida","falta una fecha de fin válida o es anterior al inicio",
   "falta clasificar el tipo de promoción","no tiene artículos (CN) incluidos"]);
});
test("activar-lote es atómico: indica qué falla en prueba 2 sin activar prueba",async()=>{
 const good={id:"P1",name:"prueba",status:"Borrador",start:"2026-11-01",end:"2026-12-31",
  durationMode:"dates",type:"dos_por_uno",cns:["123456"],targets:{"1":8},
  monthlyObjectives:{"2026-11":{targets:{"1":8}}}};
 const bad={...good,id:"P2",name:"prueba 2",type:"descuento_porcentaje",discountPercent:""};
 const queries=[],routes=new Map();
 const pool={connect:async()=>({
  async query(sql,params=[]){
   queries.push({sql,params});
   if(sql.includes("SELECT id,documento,creado_por")&&sql.includes("FOR UPDATE"))
    return {rows:[good,bad].map(p=>({id:p.id,documento:p,creado_por:"admin@example.com"}))};
   return {rows:[]};
  },release(){}
 })};
 const app={get(path,...h){routes.set("GET "+path,h.at(-1));},
  post(path,...h){routes.set("POST "+path,h.at(-1));},
  put(path,...h){routes.set("PUT "+path,h.at(-1));},
  delete(path,...h){routes.set("DELETE "+path,h.at(-1));}};
 setupTenantPromotions(app,pool,{requireTenantModule:()=>[]});
 let status=200,body,err;
 const res={status(code){status=code;return res;},json(data){body=data;return res;}};
 await routes.get("POST /api/tenant/promociones/activar-lote")({
  body:{ids:["P1","P2"]},context:{role:"administrador",client:{schema:"ampedia"},
   allowedPharmacyIds:[1],pharmacies:[{id:"1"}]},user:{email:"admin@example.com"}
 },res,e=>{err=e;});
 assert.equal(err,undefined);
 assert.equal(status,400);
 assert.match(body.error,/«prueba 2»: falta un porcentaje de descuento válido/);
 assert.deepEqual(body.invalidPromotions.map(x=>x.id),["P2"]);
 assert.equal(queries.some(q=>q.sql.startsWith("UPDATE")),false);
 assert.equal(queries.some(q=>q.sql==="ROLLBACK"),true);
 assert.equal(queries.some(q=>q.sql==="COMMIT"),false);
});

test("activar-lote publica dos borradores con metas mensuales aunque otros meses estén pendientes",async()=>{
 const base={status:"Borrador",start:"2026-11-01",end:"2026-12-31",
  durationMode:"dates",type:"dos_por_uno",cns:["123456"],targets:{"1":""},
  monthlyObjectives:{"2026-11":{targets:{"1":20}}}};
 const promos=[{...base,id:"P1",name:"prueba"},
  {...base,id:"P2",name:"prueba 2",monthlyObjectives:{"2026-11":{targets:{"1":15}}}}];
 const routes=new Map(),writes=[],queries=[];
 const pool={connect:async()=>({
  async query(sql,params=[]){
   queries.push(sql);
   if(sql.includes("SELECT id,documento,creado_por")&&sql.includes("FOR UPDATE"))
    return {rows:promos.map(p=>({id:p.id,documento:p,creado_por:"admin@example.com"}))};
   if(sql.includes("SET documento=$2::jsonb"))
    writes.push(JSON.parse(params[1]));
   return {rows:[]};
  },release(){}
 })};
 const app={get(path,...h){routes.set("GET "+path,h.at(-1));},
  post(path,...h){routes.set("POST "+path,h.at(-1));},
  put(path,...h){routes.set("PUT "+path,h.at(-1));},
  delete(path,...h){routes.set("DELETE "+path,h.at(-1));}};
 setupTenantPromotions(app,pool,{requireTenantModule:()=>[]});
 let status=200,body,err;
 const res={status(code){status=code;return res;},json(value){body=value;return res;}};
 await routes.get("POST /api/tenant/promociones/activar-lote")({
  body:{ids:["P1","P2"]},context:{role:"administrador",client:{schema:"ampedia"},
   allowedPharmacyIds:[1],pharmacies:[{id:"1"}]},user:{email:"admin@example.com"}
 },res,e=>{err=e;});
 assert.equal(err,undefined);
 assert.equal(status,200);
 assert.deepEqual(body.activatedIds,["P1","P2"]);
 assert.equal(writes.length,2);
 assert.equal(writes.every(p=>p.status==="Activa"&&p.statusSource==="manual"),true);
 assert.equal(writes.every(p=>p.monthlyObjectives["2026-12"]===undefined),true,
  "No inventar ni exigir objetivos para diciembre");
 assert.equal(queries.includes("COMMIT"),true);
 assert.equal(queries.includes("ROLLBACK"),false);
});
