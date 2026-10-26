// Diagnóstico sin lecturas de datos sensibles en logs. Se ejecuta solo bajo
// despliegue solicitado: CI no recibe credenciales de PostgreSQL de producción.
import pg from "pg";
import {readFile} from "node:fs/promises";
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
import {readUnifiedSupplierCN} from "./unifiedSuppliers.js";
import {readLaboratoryOrderMatrix} from "./laboratoryOrderPlanner.js";

const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:3,
 connectionTimeoutMillis:5000,query_timeout:32000,statement_timeout:32000});
const output={};
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
    const scans=[];
    const visit=p=>{if(/Scan/.test(p["Node Type"]||""))
     scans.push({node:p["Node Type"],table:p["Relation Name"]||"",
      index:p["Index Name"]||"",cost:Math.round(Number(p["Total Cost"]||0))});
     for(const child of p.Plans||[])visit(child)};
    visit(plan);
    output.planScans=scans.slice(0,15);
    return true;
   });
   for(const count of [Math.min(200,best.rows.length),best.rows.length].filter((x,i,a)=>a.indexOf(x)===i)){
    const res=await timed("matrix"+count,()=>readLaboratoryOrderMatrix(pool,ctx,{
     key,pharmacies,type:best.type,from,to,prefetchedRows:best.rows.slice(0,count)
    }));
    if(res)output["matrix"+count+"Complete"]=res.metricsUnavailable===false;
   }
  }
 }
 const {rows:idx}=await pool.query(`SELECT c.relname
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  JOIN pg_index i ON i.indexrelid=c.oid
  WHERE n.nspname='ampedia'
   AND c.relname LIKE 'fm_preparador_%' AND i.indisvalid AND i.indisready`);
 output.preparadorIndexes=idx.length;
}catch(e){output.code=e.code||e.name||"error"}
finally{console.log("PREPARADOR_UNIFICADO_PERF",JSON.stringify(output));await pool.end()}
