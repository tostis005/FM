import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {createHash} from "node:crypto";
import {setupTemporaryAnalyticsLinks,validTemporaryLinkToken,shareLinkExpiry} from "./aiShareLinks.js";
import {semanticCatalog,validateSemanticQuery,compileSemanticQuery} from "./aiSemanticQuery.js";

const hash=s=>createHash("sha256").update(s).digest("hex");

test("24-hour link: real PostgreSQL, expiry, revocation, tenant and admin protection",async()=>{
 let active=null, expired=false;
 const statements=[];
 const pool={
  query:async(sql,params=[])=>{
   statements.push({sql,params});
   if(sql.startsWith("SELECT slug FROM farmetrica.clientes"))return {rows:[{slug:"grupo_demo"}]};
   if(sql.includes("FROM information_schema.columns"))return {rows:[]};
   if(sql.startsWith("INSERT INTO farmetrica.ai_mcp_demo_keys")){
    active={secret_hash:params[0],cliente_slug:params[1],duracion:params[2],creado_en:new Date().toISOString()};
    expired=false;return {rows:[{creado_en:active.creado_en}]};
   }
   if(sql.startsWith("DELETE FROM farmetrica.ai_mcp_demo_keys")){active=null;return {rows:[]};}
   if(sql.startsWith("SELECT cliente_slug,creado_en,duracion FROM farmetrica.ai_mcp_demo_keys"))
    return {rows:active&&!expired?[{cliente_slug:active.cliente_slug,
      creado_en:active.creado_en,duracion:active.duracion}]:[]};
   if(sql.startsWith("SELECT cliente_slug FROM farmetrica.ai_mcp_demo_keys"))
    return {rows:active&&!expired&&active.secret_hash===params[0]?[{cliente_slug:active.cliente_slug}]:[]};
   if(sql.includes("SELECT slug,nombre,esquema_datos FROM farmetrica.clientes"))
    return {rows:[{slug:"grupo_demo",nombre:"Grupo de pruebas real",esquema_datos:"grupo_demo"}]};
   if(sql.includes("SELECT id,nombre AS name,ciudad AS city"))
    return {rows:[{id:101,name:"Farmacia Real Uno",city:"Madrid"},
     {id:102,name:"Farmacia Real Dos",city:"Madrid"}]};
   throw Error("SQL inesperado: "+sql);
  },
  connect:async()=>({
   query:async(sql,params=[])=>{
    statements.push({sql,params});
    if(sql.startsWith("SELECT f.nombre"))return {rows:[{farmacia:"Farmacia Real Uno",importe:4321.09,unidades:30}]};
    if(sql.includes(' AS "vendedor"'))return {rows:[
     {farmaciaId:101,farmacia:"Farmacia Real Uno",vendedor:"SELL-01",importe:110.40,unidades:4,movimientos:3},
     {farmaciaId:101,farmacia:"Farmacia Real Uno",vendedor:"SELL-02",importe:99.60,unidades:3,movimientos:2}
    ]};
    if(sql.includes(' AS "farmacia"'))return {rows:[
     {farmacia:"Farmacia Real Uno",importe:210,unidades:7,movimientos:5}
    ]};
    return {rows:[]};
   },
   release:()=>{}
  })
 };
 const app=express();app.use(express.json());
 const superadmin=(req,res,next)=>req.get("x-test-admin")==="yes"?next():res.sendStatus(401);
 setupTemporaryAnalyticsLinks(app,pool,{requireSuperadmin:superadmin});
 const server=await new Promise(resolve=>{
  const s=app.listen(0,"127.0.0.1",()=>resolve(s));
 });
 const base="http://127.0.0.1:"+server.address().port;
 const admin="/api/admin/ai/mcp-demo";
 const opts={method:"POST",headers:{"Content-Type":"application/json","x-test-admin":"yes",
  "x-farmetrica-admin-action":"mcp-demo-key"},body:JSON.stringify({clientSlug:"grupo_demo"})};
 try{
  assert.equal((await fetch(base+admin)).status,401);
  assert.equal((await fetch(base+admin,{...opts,headers:{"x-test-admin":"yes"}})).status,403);
  const created=await fetch(base+admin,opts);
  assert.equal(created.status,200);
  assert.match(created.headers.get("cache-control"),/no-store/);
  const generated=await created.json();
  assert.match(generated.url,/^https:\/\/farmetrica\.com\/api\/consulta-temporal\/fm_share_[A-Za-z0-9_-]{43}$/);
  const token=generated.url.split("/").at(-1);
  assert.equal(validTemporaryLinkToken(token),true);
  assert.equal(validTemporaryLinkToken("fm_share_wrong"),false);
  assert.ok(new Date(generated.expiresAt)>new Date());
  assert.equal(active.secret_hash,hash(token));
  assert.equal(active.duracion,"24h");
  assert.equal(shareLinkExpiry(active.creado_en,"24h"),generated.expiresAt);
  const path="/api/consulta-temporal/"+token;
  const landing=await fetch(base+path);
  assert.equal(landing.status,200);
  // El mismo endpoint devuelve datos diferentes para cada periodo: nunca cachear.
  for(const [header,pattern] of [
   ["cache-control",/no-store.*no-cache.*max-age=0/],
   ["cdn-cache-control",/no-store/],
   ["surrogate-control",/no-store/],
   ["pragma",/no-cache/],["expires",/^0$/],["x-accel-expires",/^0$/],
   ["vary",/^\*$/]
  ])assert.match(landing.headers.get(header)||"",pattern,"cabecera "+header);
  const landingText=await landing.text();
  assert.match(landingText,/Datos reales de PostgreSQL/);
  assert.match(landingText,/Ventas de hoy por farmacia/);
  assert.match(landingText,/Farmacias incluidas/);
  assert.match(landingText,/AGENTS.md: instrucciones, tablas, conexiones y cálculos/);
  assert.match(landingText,/AGENTS.md integrado en este mismo punto de entrada/);
  assert.match(landingText,/fm_ventas_analitica/);
  assert.match(landingText,/margen_estimado/);
  const agents=await fetch(base+path+"/AGENTS.md");
  assert.equal(agents.status,200);
  assert.match(agents.headers.get("content-type"),/text\/markdown/);
  const agentText=await agents.text();
  assert.match(agentText,/# AGENTS.md/);
  assert.match(agentText,/Granularidad:/);
  assert.match(agentText,/margen_estimado/);
  assert.match(agentText,/fm_ventas_analitica/);
  const modelResponse=await fetch(base+path+"?modelo=json");
  assert.equal(modelResponse.status,200);
  const model=await modelResponse.json();
  assert.equal(model.contrato,"farmetrica.analytics.readonly.v1");
  assert.equal(model.interprete,"farmetrica.nl.v1");
  assert.match(model.motor_ia,/Farmétrica/);
  assert.equal(model.maestro_farmacias.tabla,"farmetrica.farmacias");
  assert.equal(model.fuentes.ventas.tabla,"{esquema_cliente}.fm_ventas_analitica");
  assert.equal(model.farmacias[0].id,101);
  assert.equal(model.fuentes.ventas.calculos.importe.includes("SUM"),true);
  assert.equal(model.llamada.metodo,"GET");
  assert.equal((await fetch(base+path+"?modelo=sql")).status,400);
  const catalogResponse=await fetch(base+path+"?formato=json");
  assert.equal(catalogResponse.status,200);
  const catalog=await catalogResponse.json();
  assert.equal(catalog.origen,"PostgreSQL");
  assert.equal(catalog.ficticio,false);
  assert.equal(catalog.farmacias[0].nombre,"Farmacia Real Uno");
  assert.ok(catalog.consultas.some(x=>x.titulo.includes("hoy")));
  assert.ok(catalog.consultas.some(x=>x.titulo.includes("este año")));
  assert.ok(catalog.consultas.every(x=>x.url.startsWith(path+"?")));
  assert.equal(catalog.consultas_semanticas.version,1);
  assert.ok(catalog.consultas_semanticas.fuentes.ventas.dimensiones.includes("vendedor"));
  assert.ok(catalog.consultas_semanticas.fuentes.stock.metricas.dias_cobertura);
  assert.ok(catalog.consultas.some(x=>x.url.includes("consulta=")));
  assert.ok(catalog.consultas.every(x=>!x.url.includes("/ventas/hoy/vendedores")));
  assert.equal((await fetch(base+path+"/farmacias/101/ventas/hoy/vendedores")).status,404);
  assert.match(landing.headers.get("referrer-policy"),/no-referrer/);
  const flat=await fetch(base+path+"?fuente=ventas&agrupar=farmacia,vendedor&"+
   "metricas=importe,unidades&periodo=hoy&farmacia=Farmacia%20Real%20Uno&"+
   "ordenar=importe&direccion=desc&limite=50&formato=json");
  assert.equal(flat.status,200);
  const actual=await flat.json();
  assert.equal(actual.modo,"consulta_semantica");
  assert.equal(actual.ficticio,false);
  assert.equal(actual.fuente,"ventas");
  assert.deepEqual(actual.dimensiones,["farmacia","vendedor"]);
  assert.deepEqual(actual.metricas,["importe","unidades"]);
  assert.equal(actual.farmacias_autorizadas,1);
  const yearRanking=await fetch(base+path+"?fuente=ventas&agrupar=vendedor&"+
   "metricas=importe&periodo=este_anio&ordenar=importe&direccion=desc&formato=json");
  assert.equal(yearRanking.status,200);
  assert.match(yearRanking.headers.get("cache-control"),/no-store/);
  const annual=await yearRanking.json();
  assert.deepEqual(annual.dimensiones,["farmacia","vendedor"]);
  assert.match(annual.periodo.desde,/^20[0-9]{2}-01-01$/);
  const sellerQueries=statements.filter(x=>x.sql.includes(' AS "vendedor"')&&
   x.sql.includes("fm_ventas_analitica"));
  assert.ok(sellerQueries.some(x=>x.params[0]===annual.periodo.desde));
  assert.ok(sellerQueries.some(x=>x.params[0]===actual.periodo.desde));
  assert.notEqual(annual.periodo.desde,actual.periodo.desde,
   "Los periodos año y hoy deben generar distintos parámetros SQL");
  assert.equal((await fetch(base+path+"?fuente=ventas&metricas=importe&farmacias=999&formato=json")).status,400);
  assert.equal((await fetch(base+path+"?fuente=ventas&metricas=importe&sql=DELETE")).status,400);
  assert.equal((await fetch(base+path+"?fuente=ventas&metricas=importe&ordenar=importe")).status,400);
  const sales=await fetch(base+path+"?indicador=ventas_resumen&desde=2026-10-01&hasta=2026-10-22&formato=json");
  assert.equal(sales.status,200);
  const result=await sales.json();
  assert.equal(result.ficticio,false);
  assert.equal(result.rows[0].importe,4321.09);
  assert.ok(statements.some(x=>x.sql.includes('FROM "grupo_demo".fm_ventas_analitica t')&&x.params[0]==="2026-10-01"));
  assert.ok(!statements.some(x=>x.sql.includes('FROM "grupo_demo".ventas t')));
  assert.equal(result.cliente,"Grupo de pruebas real");
  assert.ok(statements.some(x=>x.sql==="BEGIN TRANSACTION READ ONLY"));
  assert.ok(statements.some(x=>x.sql==="ROLLBACK"));
  const pharmacy=await fetch(base+path+"?indicador=ventas_resumen&desde=2026-10-01&hasta=2026-10-22&farmacia=Farmacia%20Real%20Uno&formato=json");
  assert.equal(pharmacy.status,200);
  assert.equal((await pharmacy.json()).rows[0].importe,4321.09);
  assert.equal((await fetch(base+path+"?indicador=ventas_resumen&farmacia=Inventada")).status,400);
  assert.equal((await fetch(base+path+"?indicador=ventas_resumen&farmacia=Farmacia%20Real%20Uno&farmacias=101")).status,400);
  assert.equal((await fetch(base+path+"?indicador=DROP%20TABLE")).status,400);
  assert.equal((await fetch(base+path+"?indicador=ventas_resumen&desde=2026-01-01&hasta=2026-12-31&farmacias=999")).status,400);
  assert.equal((await fetch(base+path+"?indicador=ventas_resumen&pregunta=hola")).status,400);
  const natural=await (await fetch(base+path+"?pregunta="+
   encodeURIComponent("¿Cuánto vendió cada farmacia el 22 de octubre de 2026?")+
   "&formato=json")).json();
  assert.equal(natural.estado,"ok");
  assert.equal(natural.consulta.fuente,"ventas");
  assert.deepEqual(natural.consulta.agrupar,["farmacia"]);
  assert.equal(natural.origen,"PostgreSQL");
  assert.equal((await fetch(base+path+"?pregunta=Ventas%20hoy&desde=2026-10-22&formato=json")).status,400);

  const semanticPlan={fuente:"ventas",agrupar:["farmacia","vendedor"],metricas:["importe"],
   periodo:"hoy",limite:10};
  const semanticResponse=await fetch(base+path+"?consulta="+
   encodeURIComponent(JSON.stringify(semanticPlan))+"&formato=json");
  assert.equal(semanticResponse.status,200);
  const semanticData=await semanticResponse.json();
  assert.equal(semanticData.modo,"consulta_semantica");
  assert.equal(semanticData.fuente,"ventas");
  assert.equal(semanticData.ficticio,false);
  assert.ok(statements.some(x=>x.sql.includes("fm_ventas_analitica")));
  assert.ok(statements.some(x=>x.sql.includes("SET LOCAL statement_timeout='12000ms'")));
  const deniedSemantic=await fetch(base+path+"?consulta="+
   encodeURIComponent(JSON.stringify({fuente:"ventas",sql:"DROP TABLE clientes"})));
  assert.equal(deniedSemantic.status,400);
  const stockPlan={fuente:"stock",agrupar:["farmacia","producto"],
   metricas:["stock_actual","dias_cobertura"],estado_stock:"bajo"};
  assert.equal((await fetch(base+path+"?consulta="+
   encodeURIComponent(JSON.stringify(stockPlan))+"&formato=json")).status,200);
  expired=true;
  assert.equal((await fetch(base+path)).status,410);
  const renewed=await (await fetch(base+admin,opts)).json();
  assert.notEqual(renewed.url,generated.url);
  assert.equal((await fetch(base+path)).status,410);
  const longOpts={...opts,body:JSON.stringify({clientSlug:"grupo_demo",duracion:"indefinido"})};
  const foreverResponse=await fetch(base+admin,longOpts);
  assert.equal(foreverResponse.status,200);
  const forever=await foreverResponse.json();
  assert.equal(forever.duracion,"indefinido");
  assert.equal(forever.expiresAt,null);
  const status=await (await fetch(base+admin,{headers:{"x-test-admin":"yes"}})).json();
  assert.equal(status.configured,true);
  assert.equal(status.duracion,"indefinido");
  for(const [duracion,days] of [["7d",7],["30d",30],["365d",365]]){
   const response=await fetch(base+admin,{...opts,body:JSON.stringify({clientSlug:"grupo_demo",duracion})});
   assert.equal(response.status,200);
   const data=await response.json();
   assert.equal(data.duracion,duracion);
   assert.equal(new Date(data.expiresAt).getTime()-new Date(active.creado_en).getTime(),days*86400000);
  }
  const invalid=await fetch(base+admin,{...opts,body:JSON.stringify({clientSlug:"grupo_demo",duracion:"600d"})});
  assert.equal(invalid.status,400);
  const revoked=await fetch(base+admin,{method:"DELETE",headers:opts.headers});
  assert.equal(revoked.status,200);
  assert.equal((await fetch(base+"/api/consulta-temporal/"+renewed.url.split("/").at(-1))).status,410);
  assert.equal((await fetch(base+"/api/consulta-temporal/fm_share_wrong")).status,404);
 }finally{await new Promise(resolve=>server.close(resolve));}
});

test("Catálogo semántico SQL controlado: vendedores, productos, stock e histórico",()=>{
 const ctx={role:"administrador",modules:{ventas:true,compras:true,stock:true},client:{slug:"demo",schema:"demo"},allowedPharmacyIds:[101,102]};
 const sales={fuente:"ventas",agrupar:["farmacia","vendedor"],metricas:["importe","unidades"],
  periodo:"hoy",ordenar:{campo:"importe",direccion:"desc"},farmacias:[101],limite:20};
 const data=compileSemanticQuery(sales,ctx);
 assert.match(data.sql,/fm_ventas_analitica/);
 assert.match(data.sql,/vendedor/);
 assert.match(data.sql,/(?:b\.farmacia_id|f\.id) AS "farmaciaId"/);
 assert.match(data.sql,/READ ONLY|SELECT/);
 assert.match(data.sql,/f\.cliente_slug=\$4/);
 assert.match(data.sql,/f\.id=ANY\(\$3::int\[\]\)/);
 assert.deepEqual(data.params[2],[101]);
 assert.equal(data.params[3],"demo");
 assert.equal(data.params.at(-1),20);
 assert.match(data.sql,/ORDER BY "importe" DESC/);
 assert.doesNotMatch(data.sql,/LEFT JOIN LATERAL/,"Ventas por vendedor no deben consultar el catálogo de artículos");
 const annualSellers=compileSemanticQuery({fuente:"ventas",agrupar:["vendedor"],
  metricas:["importe"],periodo:"este_anio",ordenar:{campo:"importe",direccion:"desc"}},ctx);
 assert.deepEqual(annualSellers.q.dims,["farmacia","vendedor"]);
 assert.match(annualSellers.sql,/GROUP BY (?:b\.farmacia_id,b\.farmacia,b\.vendedor|f\.id,f\.nombre,nullif\(btrim\(t\.vendedor_id::text\))/);
 assert.match(annualSellers.sql,/(?:b\.farmacia_id|f\.id) AS "farmaciaId"/);
 assert.match(annualSellers.params[0],/^20\d{2}-01-01$/);
 assert.throws(()=>validateSemanticQuery({fuente:"ventas",agrupar:["vendedor","dia","mes"],
  metricas:["importe"],periodo:"este_anio"},ctx),/incluye farmacia/);
 const long=compileSemanticQuery({fuente:"ventas",agrupar:["anio"],metricas:["importe"],
  periodo:"historico"},ctx);
 assert.equal(long.params[0],null);
 assert.equal(long.params[1],null);
 const margin=compileSemanticQuery({fuente:"ventas",agrupar:["producto"],
  metricas:["margen_estimado","lineas_con_coste"],periodo:"este_mes"},ctx);
 assert.match(margin.sql,/a\.pmc>0/);
 assert.match(margin.sql,/LEFT JOIN LATERAL/);
 const inventory=compileSemanticQuery({fuente:"stock",agrupar:["farmacia","producto"],
  metricas:["stock_actual","venta_90d","dias_cobertura"],estado_stock:"bajo",
  dias_max:15},ctx);
 assert.match(inventory.sql,/fm_ventas_analitica/);
 assert.match(inventory.sql,/stock_actual/);
 assert.match(inventory.sql,/f\.id=ANY\(\$3::int\[\]\)/);
 assert.ok(inventory.params.includes(15));
 const purchases=compileSemanticQuery({fuente:"compras",agrupar:["proveedor","mes"],
  metricas:["importe","coste_unitario_medio"],periodo:"mes_pasado"},ctx);
 assert.match(purchases.sql,/fm_recepciones_analitica/);
 assert.equal(semanticCatalog().fuentes.stock.origen,"articulos");
 for(const bad of [
  {fuente:"ventas",agrupar:["secreto"]},
  {fuente:"ventas",agrupar:["farmacia"],metricas:["importe"],farmacias:[999]},
  {fuente:"ventas",agrupar:["farmacia"],metricas:["importe"],limite:9999},
  {fuente:"stock",estado_stock:"bajo",dias_max:999},
  {fuente:"ventas",sql:"SELECT * FROM users"},
  {fuente:"ventas",ordenar:{campo:"1;DROP TABLE",direccion:"asc"}},
  {fuente:"ventas",metricas:["capital_estimado"]},
  {fuente:"ventas",desde:"2026-02-30",hasta:"2026-03-01"}
 ])assert.throws(()=>validateSemanticQuery(bad,ctx));
 const denied={...ctx,modules:{ventas:true,compras:false,stock:false}};
 assert.throws(()=>validateSemanticQuery({fuente:"compras",metricas:["importe"]},denied),/acceso/i);
 assert.throws(()=>validateSemanticQuery({fuente:"stock",metricas:["stock_actual"]},denied),/acceso/i);
 assert.equal(shareLinkExpiry("2026-10-22T10:00:00Z","indefinido"),null);
 assert.equal(shareLinkExpiry("2026-10-22T10:00:00Z","7d"),"2026-10-29T10:00:00.000Z");
});
