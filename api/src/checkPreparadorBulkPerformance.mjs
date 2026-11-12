// Diagnóstico sin lecturas de datos sensibles en logs. Se ejecuta solo bajo
// despliegue solicitado: CI no recibe credenciales de PostgreSQL de producción.
// Medición puntual solicitada: mismo conjunto de pruebas para comparar con
// PREPARADOR_UNIFICADO_PERF anterior, sin cambiar consultas ni datos de pedidos.
import pg from "pg";
import {readFile} from "node:fs/promises";
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
import {readUnifiedSupplierCN} from "./unifiedSuppliers.js";
import {readLaboratoryOrderMatrix,indexedNormalizedCNMetricsSQL,skipWarehouseForMedication} from "./laboratoryOrderPlanner.js";

const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:3,
 connectionTimeoutMillis:5000,query_timeout:32000,statement_timeout:32000});
const output={};
function sameMetrics(a,b){
 if(!a||!b||a.metricsUnavailable||b.metricsUnavailable||a.rows.length!==b.rows.length)return null;
 const measure=rows=>rows.map(r=>JSON.stringify({
  reference:r.referencia,cn:r.cn,stock:r.pharmacyStock,warehouse:r.warehouseStock,
  global:r.globalStock,sold:r.totalSold,suggested:r.totalSuggested,
  warehouseMetrics:r.warehouse,
  pharmacies:Object.fromEntries(Object.entries(r.byPharmacy||{}).sort(([a],[b])=>a.localeCompare(b)))
 })).join("\n");
 return measure(a.rows)===measure(b.rows);
}
async function timed(name,fn){
 const start=Date.now();
 try{const result=await fn();output[name+"Ms"]=Date.now()-start;return result}
 catch(e){output[name+"Ms"]=Date.now()-start;output[name+"Code"]=e.code||e.name||"error";return null}
}
try{
 const {rows:scope}=await pool.query("SELECT c.esquema_datos AS schema, array_agg(f.id ORDER BY f.id) AS pharmacies FROM farmetrica.clientes c JOIN farmetrica.farmacias f ON f.cliente_slug=c.slug WHERE c.slug='ampedia' GROUP BY c.esquema_datos");
 if(scope.length!==1||!/^[a-z][a-z0-9_]{1,62}$/.test(scope[0].schema))throw Error("Sin cliente");
 const pharmacies=scope[0].pharmacies,ctx={client:{slug:"ampedia",schema:scope[0].schema}};
 output.pharmacyCount=pharmacies.length;
 const {rows:found}=await pool.query(`SELECT id::text
  FROM farmetrica.proveedores_unificados
  WHERE cliente_slug='ampedia' AND activo=true AND clase NOT IN ('MAYORISTA','INTERNO','SIN_CLASIFICAR')
   AND nombre ILIKE '%cinfa%'
  ORDER BY id LIMIT 1`);
 if(!found.length){output.skipped="proveedor_no_encontrado"}
 else{
  const key="P:"+found[0].id;
  const candidates=[];
  for(const type of ["medicacion","parafarmacia"]){
   const data=await timed("catalog_"+type,()=>readUnifiedSupplierCN(pool,ctx,{key,pharmacies,type}));
   if(data){candidates.push({type,rows:data.rows});output[type+"References"]=data.rows.length;}
  }
  const best=candidates.sort((a,b)=>b.rows.length-a.rows.length)[0];
  if(best?.rows.length){
   const date=new Date(),to=date.toISOString().slice(0,10);
   const from=new Date(date.getTime()-30*86400000).toISOString().slice(0,10);
   // EXPLAIN no ejecuta ventas: diagnóstico del plan elegido con 200 CN.
   await timed("explain200",async()=>{
    const {rows:columns}=await pool.query(`SELECT EXISTS (
     SELECT 1 FROM information_schema.columns
     WHERE table_schema=$1 AND table_name='articulos'
      AND column_name='cn_normalizado') AS native`,[ctx.client.schema]);
    const raw=await readFile(new URL("./laboratoryOrderMetrics.sql",import.meta.url),"utf8");
    const sql=raw.replaceAll("__SCHEMA__",'"'+ctx.client.schema+'"')
     .replaceAll("__FARMACIA_CODE__",pharmacyDataCodeSQL("f"))
     .replaceAll("__CN_NORMALIZED__",columns[0]?.native?"a.cn_normalizado":"to_jsonb(a)->>'cn_normalizado'");
    const selected=best.rows.slice(0,200).map(x=>({reference:x.referencia,cn:x.cn||null}));
    const {rows:explain}=await pool.query({text:"EXPLAIN (FORMAT JSON) "+sql,
     values:[JSON.stringify(selected),pharmacies,ctx.client.slug,from,to,7],query_timeout:10000});
    const plan=explain[0]?.["QUERY PLAN"]?.[0]?.Plan;
    if(!plan)return null;
    output.estimatedCost=Math.round(Number(plan["Total Cost"]||0));
    output.nativeCN=columns[0]?.native===true;
    const indexSQL=indexedNormalizedCNMetricsSQL(skipWarehouseForMedication(raw))
     .replaceAll("__SCHEMA__",'"'+ctx.client.schema+'"')
     .replaceAll("__FARMACIA_CODE__",pharmacyDataCodeSQL("f"))
     .replaceAll("__CN_NORMALIZED__",columns[0]?.native?"a.cn_normalizado":"NULL::text");
    const indexPlan=await pool.query({text:"EXPLAIN (FORMAT JSON) "+indexSQL,
     values:[JSON.stringify(selected),pharmacies,ctx.client.slug,from,to,"medicacion"],query_timeout:10000});
    output.indexedCNCost=Math.round(Number(indexPlan.rows[0]?.["QUERY PLAN"]?.[0]?.Plan?.["Total Cost"]||0));
    const indexedScans=[];
    const visitIndexed=p=>{if(/Scan/.test(p["Node Type"]||""))
      indexedScans.push({node:p["Node Type"],table:p["Relation Name"]||"",
       index:p["Index Name"]||"",cost:Math.round(Number(p["Total Cost"]||0))});
      for(const child of p.Plans||[])visitIndexed(child)};
    visitIndexed(indexPlan.rows[0]?.["QUERY PLAN"]?.[0]?.Plan||{});
    output.indexedCNScans=indexedScans.filter(x=>x.table==="articulos").slice(0,10);
    const scans=[];
    const visit=p=>{if(/Scan/.test(p["Node Type"]||""))
     scans.push({node:p["Node Type"],table:p["Relation Name"]||"",
      index:p["Index Name"]||"",cost:Math.round(Number(p["Total Cost"]||0))});
     for(const child of p.Plans||[])visit(child)};
    visit(plan);
    output.planScans=scans.slice(0,15);
    return true;
   });
   let baseline200=null,baseline75=null;
   for(const count of [Math.min(50,best.rows.length),Math.min(75,best.rows.length),
     Math.min(100,best.rows.length),Math.min(200,best.rows.length)]
     .filter((x,i,a)=>a.indexOf(x)===i)){
    const res=await timed("matrix"+count,()=>readLaboratoryOrderMatrix(pool,ctx,{
     key,pharmacies,type:best.type,from,to,prefetchedRows:best.rows.slice(0,count),indexedCN:false
    }));
    if(res)output["matrix"+count+"Complete"]=res.metricsUnavailable===false;
    if(count===200)baseline200=res;
    if(count===75)baseline75=res;
   }
   const indexed75=await timed("indexedCN75",()=>readLaboratoryOrderMatrix(pool,ctx,{
    key,pharmacies,type:best.type,from,to,
    prefetchedRows:best.rows.slice(0,75),indexedCN:true
   }));
   if(indexed75){
    output.indexedCN75Complete=indexed75.metricsUnavailable===false;
    output.indexedCN75EqualsBaseline=sameMetrics(baseline75,indexed75);
   }
   const candidate=await timed("indexedCN200",()=>readLaboratoryOrderMatrix(pool,ctx,{
    key,pharmacies,type:best.type,from,to,
    prefetchedRows:best.rows.slice(0,200),indexedCN:true
   }));
   if(candidate){
    output.indexedCN200Complete=candidate.metricsUnavailable===false;
    output.indexedCN200EqualsBaseline=sameMetrics(baseline200,candidate);
   }
   if(candidate?.metricsUnavailable===false&&output.indexedCN200Ms<16000){
    const full=await timed("indexedCNFull",()=>readLaboratoryOrderMatrix(pool,ctx,{
      key,pharmacies,type:best.type,from,to,prefetchedRows:best.rows,indexedCN:true
    }));
    if(full)output.indexedCNFullComplete=full.metricsUnavailable===false;
   }
  }
 }
 const {rows:idx}=await pool.query(`SELECT c.relname
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_index i ON i.indexrelid=c.oid
  WHERE n.nspname='ampedia'
   AND c.relname LIKE 'fm_preparador_%' AND i.indisvalid AND i.indisready`);
 output.preparadorIndexes=idx.length;
 // Traza real de Cantabria (003652): catálogo separado de métricas. Nunca
 // registra importes, unidades concretas ni documentos de ningún cliente.
 const {rows:cantabria}=await pool.query({
  text:`SELECT id::text FROM farmetrica.proveedores_unificados
   WHERE cliente_slug='ampedia' AND activo=true AND nombre='CANTABRIA'
    AND clase IN ('DIRECTO','VACUNAS','FÓRMULAS') ORDER BY id LIMIT 1`,
  query_timeout:4000});
 if(cantabria.length){
  const key="P:"+cantabria[0].id;
  const para=await timed("cantabriaCatalog",()=>
   readUnifiedSupplierCN(pool,ctx,{key,pharmacies,type:"parafarmacia"}));
  if(para){
   output.cantabriaTotal=para.total;
   output.cantabriaTargetPresent=para.rows.some(r=>r.cn==="003652");
   const target=para.rows.find(r=>r.cn==="003652");
   const candidates=[...(target?[target]:[]),
    ...para.rows.filter(r=>r.cn!=="003652")];
   const now=new Date(),to=now.toISOString().slice(0,10);
   const from=new Date(now.getTime()-30*86400000).toISOString().slice(0,10);
   const uniqueSizes=[...new Set([1,Math.min(50,candidates.length),
    Math.min(200,candidates.length),candidates.length])].filter(x=>x>0);
   let cantabriaBaseline200=null;
   for(const n of uniqueSizes){
    const matrix=await timed("cantabriaMatrix"+n,()=>
     readLaboratoryOrderMatrix(pool,ctx,{key,pharmacies,type:"parafarmacia",
      from,to,prefetchedRows:candidates.slice(0,n),indexedCN:false}));
    if(n===200)cantabriaBaseline200=matrix;
    if(matrix){
     output["cantabriaMatrix"+n+"Complete"]=matrix.metricsUnavailable===false;
     output["cantabriaMatrix"+n+"Error"]=matrix.metricsErrorCode||null;
     output["cantabriaMatrix"+n+"MetricsRows"]=matrix.rows.filter(r=>
      Object.keys(r.byPharmacy||{}).length>0).length;
     output["cantabriaMatrix"+n+"StockPresent"]=matrix.rows.filter(r=>
      Object.values(r.byPharmacy||{}).some(m=>m.stock!==null)).length;
     output["cantabriaMatrix"+n+"SalesPresent"]=matrix.rows.filter(r=>
      Object.values(r.byPharmacy||{}).some(m=>m.units12!==null&&m.units12!==undefined)).length;
    }
   }
   const indexed200=await timed("cantabriaIndexedCN200",()=>readLaboratoryOrderMatrix(
    pool,ctx,{key,pharmacies,type:"parafarmacia",from,to,
     prefetchedRows:candidates.slice(0,200),indexedCN:true}));
   if(indexed200){
    output.cantabriaIndexedCN200Complete=indexed200.metricsUnavailable===false;
    output.cantabriaIndexedCN200EqualsBaseline=sameMetrics(cantabriaBaseline200,indexed200);
   }
  }
 }

}catch(e){output.code=e.code||e.name||"error"}
finally{console.log("PREPARADOR_UNIFICADO_PERF",JSON.stringify(output));await pool.end()}
