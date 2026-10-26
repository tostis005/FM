// Diagnóstico sin lecturas de datos sensibles en logs. Se ejecuta solo bajo
// despliegue solicitado: CI no recibe credenciales de PostgreSQL de producción.
import pg from "pg";
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
