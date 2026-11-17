import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {sumGenericOfferSales,setupGenericOfferSales} from "./genericOfferSales.js";

test("agrega unidades de CN directos e IDs ERP por DCPF sin duplicar ventas",()=>{
 const groups=[{cn:"400123",dcpf:"10"},{cn:"400124",dcpf:"10"},{cn:"500001",dcpf:"20"}];
 const mapped=[{code:"ABA",article:"F001",cn:"400123"},
  {code:"ABA",article:"F002",cn:"400124"},{code:"EUR",article:"X1",cn:"500001"}];
 const sales=[{code:"ABA",article:"F001",units:8},{code:"ABA",article:"F002",units:5},
  {code:"EUR",article:"X1",units:7},{code:"ABA",article:"400123",units:3},
  {code:"ABA",article:"OTRO",units:200},{code:"ABA",article:"F001",units:-2}];
 assert.deepEqual([...sumGenericOfferSales(groups,mapped,sales)],[["10",14],["20",7]]);
});

test("endpoint de ventas rechaza otras farmacias y conserva el período seleccionado",async()=>{
 const routes=new Map(),queries=[];
 const app={post(path,...handlers){routes.set(path,handlers.at(-1))}};
 const pool={async query(q){
  const sql=typeof q==="string"?q:q.text;queries.push(q);
  if(sql.includes("to_char(clock_timestamp()"))return {rows:[{today:"2026-11-17"}]};
  if(sql.includes("ventas_panorama_meses_cerrados"))return {rows:[]};
  if(sql.includes("information_schema.columns"))
   return {rows:[
    ...["farmacia_codigo","origen_id","codigo_nacional","sincronizado_en"]
     .map(column_name=>({table_name:"articulos",column_name})),
    ...["farmacia_codigo","articulo_id","fecha","unidades"]
     .map(column_name=>({table_name:"fm_ventas_analitica",column_name}))
   ]};
  if(sql.includes("SELECT")&&sql.includes("farmetrica.farmacias f"))return {rows:[{id:1,code:"ABA"}]};
  if(sql.includes("FROM farmetrica.nomenclator_presentaciones n"))
   return {rows:[{cn:"400123",dcpf:"10"}]};
  if(sql.includes("DISTINCT ON"))return {rows:[{code:"ABA",article:"F001",cn:"400123"}]};
  if(sql.includes("sum(v.unidades)"))return {rows:[{code:"ABA",article:"F001",units:6}]};
  throw Error("Consulta inesperada: "+sql.slice(0,100));
 }};
 setupGenericOfferSales(app,pool,{requireTenantModule:()=>[]});
 const fn=routes.get("/api/genericos/ofertas/ventas");
 assert.equal(typeof fn,"function");
 const context={client:{slug:"ejemplo",schema:"datos_ejemplo"},allowedPharmacyIds:[1]};
 const run=async(body)=>{
  const req={body,context};
  const res={statusCode:200,status(n){this.statusCode=n;return this},
   json(data){this.data=data;return this}};
  await fn(req,res,e=>{throw e});
  return res;
 };
 const bad=await run({desde:"2026-01-01",hasta:"2026-10-31",farmacias:[2],dcpfs:["10"]});
 assert.equal(bad.statusCode,400);
 assert.equal(queries.length,0);
 const ok=await run({desde:"2026-01-01",hasta:"2026-10-31",farmacias:[1],dcpfs:["10"]});
 assert.equal(ok.statusCode,200);
 assert.deepEqual(ok.data,{salesAvailable:true,items:[{dcpf:"10",units:6}]});
 assert.ok(queries.some(q=>q.values?.includes("ejemplo")));
 assert.ok(queries.some(q=>q.values?.includes("2026-10-31")));
});

// Regresión del error de producción: la API existía, pero faltaba registrarla
// en server.js; las pruebas unitarias del endpoint no detectaban ese olvido.
test("la ruta de ventas del comparador está conectada al servidor",()=>{
 const source=readFileSync(new URL("./server.js",import.meta.url),"utf8");
 assert.match(source,/import\s*\{\s*setupGenericOfferSales\s*\}\s*from\s*["']\.\/genericOfferSales\.js["']/);
 assert.match(source,/setupGenericOfferSales\(app,pool,\{requireTenantModule\}\)/);
});

test("ventana parcialmente cerrada suma resumen mensual y ventas recientes sin duplicar",async()=>{
 const routes=new Map(),sqls=[];
 const app={post(path,...h){routes.set(path,h.at(-1))}};
 const pool={async query(q){
  const sql=typeof q==="string"?q:q.text;
  sqls.push(sql);
  if(sql.includes("information_schema.columns"))
   return {rows:[
    ...["farmacia_codigo","origen_id","codigo_nacional","sincronizado_en"]
     .map(column_name=>({table_name:"articulos",column_name})),
    ...["farmacia_codigo","articulo_id","fecha","unidades"]
     .map(column_name=>({table_name:"fm_ventas_analitica",column_name}))
   ]};
  if(sql.includes("farmetrica.farmacias f"))return {rows:[{id:1,code:"ABA"}]};
  if(sql.includes("FROM farmetrica.nomenclator_presentaciones n"))
   return {rows:[{cn:"400123",dcpf:"10"}]};
  if(sql.includes("DISTINCT ON"))
   return {rows:[{code:"ABA",article:"F001",cn:"400123"}]};
  if(sql.includes("to_char(clock_timestamp()"))
   return {rows:[{today:"2026-11-17"}]};
  if(sql.includes("ventas_panorama_meses_cerrados"))
   return {rows:[{farmacia_id:1,mes:"2026-01-01"}]};
  if(sql.includes("FROM farmetrica.ventas_panorama_mensual"))
   return {rows:[{farmacia_id:1,mes:"2026-01-01",article:"F001",units:42}]};
  if(sql.includes("sum(v.unidades)"))
   return {rows:[{code:"ABA",article:"F001",units:8}]};
  throw Error("Consulta inesperada: "+sql.slice(0,100));
 }};
 setupGenericOfferSales(app,pool,{requireTenantModule:()=>[]});
 const fn=routes.get("/api/genericos/ofertas/ventas");
 const req={context:{client:{slug:"ejemplo",schema:"datos_ejemplo"},allowedPharmacyIds:[1]},
  body:{desde:"2026-01-01",hasta:"2026-02-15",farmacias:[1],dcpfs:["10"]}};
 const res={statusCode:200,status(n){this.statusCode=n;return this},
  json(data){this.data=data;return this}};
 await fn(req,res,e=>{throw e});
 assert.equal(res.statusCode,200);
 assert.deepEqual(res.data,{salesAvailable:true,items:[{dcpf:"10",units:50}]});
 const raw=sqls.find(q=>q.includes("sum(v.unidades)")&&q.includes("fm_ventas_analitica"));
 assert.match(raw,/v\.farmacia_codigo=ANY/);
 assert.ok(!raw.includes("upper(btrim(v.farmacia_codigo))"));
 assert.ok(sqls.some(q=>q.includes("ventas_panorama_mensual")));
});
