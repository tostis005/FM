import test from "node:test";
import assert from "node:assert/strict";
import {compileSemanticQuery,runSemanticQuery,semanticCatalogForContext} from "./aiSemanticQuery.js";
import {interpretSemanticQuestion} from "./semanticInterpreter.js";
import {presentSemanticResult} from "./semanticPresentation.js";

const ctx={role:"administrador",client:{slug:"ampedia",schema:"ampedia",name:"Ampedia"},
 modules:{dashboard:true,ventas:true,compras:true,stock:true},
 allowedPharmacyIds:[1,2],
 pharmacies:[{id:1,name:"Abadía"},{id:2,name:"Europa"}]};
const now=new Date("2026-10-23T09:00:00Z");
const plan=q=>interpretSemanticQuestion(q,ctx,{now});

test("compras: proveedor se agrupa por código ERP y farmacia, nunca nombre nulo",()=>{
 const q=compileSemanticQuery({fuente:"compras",agrupar:["proveedor"],
  metricas:["importe"],desde:"2026-10-01",hasta:"2026-10-22"},ctx);
 assert.deepEqual(q.q.dims,["farmacia","proveedor"]);
 assert.match(q.sql,/t\.proveedor_id::text/);
 assert.match(q.sql,/NULLIF|coalesce\(nullif\(btrim\(t\.proveedor_id/);
 assert.match(q.sql,/b\.farmacia_id AS "farmaciaId"/);
 assert.match(q.sql,/GROUP BY b\.farmacia_id,b\.farmacia,b\.proveedor/);
 assert.doesNotMatch(q.sql,/t\.proveedor_nombre AS proveedor/);
 assert.deepEqual(q.params,["2026-10-01","2026-10-22",[1,2],"ampedia",30]);
});
test("filtros de proveedores autorizados usan parámetros y tenant, nunca SQL del texto",()=>{
 const input={fuente:"compras",agrupar:["proveedor"],metricas:["importe"],
  proveedor:"Cooperativa X' OR TRUE --",periodo:"este_mes"};
 const q=compileSemanticQuery(input,ctx);
 assert.match(q.sql,/pm\.cliente_slug=\$4/);
 assert.match(q.sql,/pm\.nombre ILIKE \$5/);
 assert.match(q.sql,/t\.proveedor_id::text ILIKE \$5/);
 assert.doesNotMatch(q.sql,/Cooperativa X|OR TRUE --/);
 assert.equal(q.params[4],"%Cooperativa X' OR TRUE --%");
 assert.equal(q.params.at(-1),30);
 assert.ok(q.sql.includes('JOIN farmetrica.farmacias f ON f.cliente_slug=$4'));
});
test("resuelve nombres locales de proveedor por farmacia, sin mostrar código ERP",async()=>{
 const seen=[];
 const pool={
  connect:async()=>({
   query:async(sql,args)=>{
    seen.push({sql,args});
    if(/SELECT.*FROM "ampedia"\.fm_recepciones_analitica/s.test(sql))
     return {rows:[
      {farmaciaId:1,farmacia:"Abadía",proveedor:"12",importe:100},
      {farmaciaId:2,farmacia:"Europa",proveedor:"12",importe:200}
     ]};
    return {rows:[]};
   },release(){}
  }),
  query:async(sql,args)=>{
   seen.push({sql,args});
   if(sql.includes("information_schema.columns"))return {rows:[
    ...["farmacia_codigo","origen_id","nombre"].map(column_name=>({table_name:"proveedores",column_name}))
   ]};
   if(sql.includes('FROM "ampedia"."proveedores" m'))return {rows:[
    {pharmacyId:"1",code:"12",name:"Proveedor Norte"},
    {pharmacyId:"2",code:"12",name:"Proveedor Sur"}
   ]};
   if(sql.includes("FROM farmetrica.proveedores_maestro"))return {rows:[]};
   return {rows:[]};
  }
 };
 const d=await runSemanticQuery(pool,ctx,{fuente:"compras",agrupar:["proveedor"],
  metricas:["importe"],desde:"2026-10-01",hasta:"2026-10-22"});
 assert.deepEqual(d.dimensiones,["farmacia","proveedor"]);
 assert.deepEqual(d.filas.map(r=>r.proveedor),["Proveedor Norte","Proveedor Sur"]);
 assert.deepEqual(d.filas.map(r=>r.proveedorCodigo),["12","12"]);
 assert.deepEqual(d.filas.map(r=>r.importe),[100,200]);
 const publicResult=presentSemanticResult({estado:"ok",...d});
 assert.deepEqual(publicResult.columnas,["Farmacia","Proveedor","Compras"]);
 assert.deepEqual(publicResult.filas,[
  {Farmacia:"Abadía",Proveedor:"Proveedor Norte",Compras:"100,00 €"},
  {Farmacia:"Europa",Proveedor:"Proveedor Sur",Compras:"200,00 €"}
 ]);
 assert.doesNotMatch(JSON.stringify(publicResult),/proveedorCodigo|farmaciaId/);
 assert.ok(seen.some(x=>x.sql==="BEGIN TRANSACTION READ ONLY"));
});
test("NL: períodos arbitrarios, compras por proveedor, ventas por fecha y solares",()=>{
 const a=plan("Ventas por vendedor y por fecha de los últimos 45 días");
 assert.equal(a.estado,"ok",JSON.stringify(a));
 assert.deepEqual(a.consulta.agrupar,["farmacia","vendedor","dia"]);
 assert.deepEqual([a.consulta.desde,a.consulta.hasta],["2026-09-09","2026-10-23"]);
 const b=plan("¿Cuánto hemos gastado en el proveedor Cofares este mes?");
 assert.equal(b.estado,"ok",JSON.stringify(b));
 assert.equal(b.consulta.fuente,"compras");
 assert.equal(b.consulta.proveedor,"cofares");
 const c=plan("Ventas de solares el año pasado");
 assert.equal(c.estado,"ok",JSON.stringify(c));
 assert.deepEqual([c.consulta.desde,c.consulta.hasta],["2025-01-01","2025-12-31"]);
 assert.equal(c.consulta.producto,"categoria:solares");
 const solarSql=compileSemanticQuery(c.consulta,ctx);
 assert.match(solarSql.sql,/ILIKE '%fotoprotect%'/);
 assert.match(solarSql.sql,/a\.nombre/);
 assert.equal(solarSql.params[4],"%solar%");
 const d=plan("Ventas por farmacia desde el 1 de enero de 2026 hasta hoy");
 assert.equal(d.estado,"ok",JSON.stringify(d));
 assert.deepEqual([d.consulta.desde,d.consulta.hasta],["2026-01-01","2026-10-23"]);
});
test("margen es estimado, nunca ventas menos compras ni contabilidad",()=>{
 const g=plan("¿Cuál es el porcentaje de margen estimado de ventas por farmacia este mes?");
 assert.equal(g.estado,"ok",JSON.stringify(g));
 assert.deepEqual(g.consulta.metricas,["margen_estimado_pct"]);
 const c=compileSemanticQuery(g.consulta,ctx);
 assert.match(c.sql,/sum\(b\.margen_estimado\)/);
 assert.match(c.sql,/FILTER\(WHERE b\.margen_estimado IS NOT NULL\)/);
 assert.equal(plan("¿Cuánto beneficio neto obtuvimos este mes?").estado,"no_disponible");
});
test("MCP: catálogo de relaciones y planes con SQL arbitrario rechazado",()=>{
 const c=semanticCatalogForContext(ctx);
 assert.match(c.mapa_relaciones.compras,/proveedor_id/);
 assert.match(c.interpretacion.margen,/NO ventas menos compras/);
 assert.ok(c.ejemplos.some(x=>x.consulta.producto==="categoria:solares"));
 assert.throws(()=>compileSemanticQuery({fuente:"ventas",metricas:["importe"],
  sql:"SELECT * FROM pacientes"},ctx),/no autorizados/);
});


test("nombre de proveedor consulta maestro local con código y farmacia solo si hay clave compuesta",()=>{
 const input={fuente:"compras",agrupar:["farmacia","proveedor"],metricas:["importe"],
  proveedor:"Cofares",desde:"2026-10-01",hasta:"2026-10-22"};
 const a=compileSemanticQuery(input,{...ctx,localSupplierCatalogAvailable:true});
 assert.match(a.sql,/EXISTS \(SELECT 1 FROM "ampedia"\.proveedores local_p/);
 assert.match(a.sql,/upper\(btrim\(local_p\.farmacia_codigo::text\)\)=upper\(btrim\(t\.farmacia_codigo::text\)\)/);
 assert.match(a.sql,/upper\(btrim\(local_p\.origen_id::text\)\)=upper\(btrim\(t\.proveedor_id::text\)\)/);
 assert.match(a.sql,/local_p\.nombre ILIKE \$5/);
 assert.equal(a.params[4],"%Cofares%");
 const b=compileSemanticQuery(input,ctx);
 assert.doesNotMatch(b.sql,/local_p/,"no usar una estructura local aún no verificada");
});
test("una consulta por nombre activa JOIN local tras comprobar columnas del tenant",async()=>{
 const seen=[];
 const pool={
  query:async(sql,args)=>{
   seen.push({sql,args});
   if(sql.includes("information_schema.columns")&&sql.includes("count(DISTINCT"))
    return {rows:[{n:3}]};
   return {rows:[]};
  },
  connect:async()=>({query:async(sql,args)=>{
   seen.push({sql,args});
   return {rows:[]};
  },release(){} })
 };
 await runSemanticQuery(pool,ctx,{fuente:"compras",agrupar:["farmacia","proveedor"],
  metricas:["importe"],proveedor:"Cofares",desde:"2026-10-01",hasta:"2026-10-22"});
 assert.ok(seen.some(x=>x.sql.includes('FROM "ampedia".fm_recepciones_analitica')&&
  x.sql.includes('FROM "ampedia".proveedores local_p')));
 assert.ok(seen.some(x=>x.sql.includes("information_schema.columns")&&x.args[0]==="ampedia"));
 assert.ok(seen.some(x=>x.sql==="BEGIN TRANSACTION READ ONLY"));
});
