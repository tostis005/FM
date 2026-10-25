// Medición de solo lectura, en el mismo PostgreSQL del VPS.
// No muestra CN, artículo, proveedor, importe ni detalles de farmacia.
import pg from "pg";
import {listOperationalLaboratoryOptions} from "./laboratoryCatalog.js";
import {readDirectLaboratoryCatalog} from "./laboratoryFastCatalog.js";
import {readLaboratoryOrderMatrix} from "./laboratoryOrderPlanner.js";
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:3,
 connectionTimeoutMillis:5000,query_timeout:40000,statement_timeout:40000});
const result={pharmacies:0},measure=async(label,fn)=>{
 const started=Date.now();
 try{const value=await fn();result[label+"Ms"]=Date.now()-started;return value}
 catch(e){result[label+"Ms"]=Date.now()-started;
  result[label+"Error"]=e.code||e.name||"Error";return null}
};
try{
 const [tenants,ph]=await Promise.all([
  pool.query("SELECT esquema_datos FROM farmetrica.clientes WHERE slug='ampedia'"),
  pool.query("SELECT id FROM farmetrica.farmacias WHERE cliente_slug='ampedia' ORDER BY id")
 ]);
 const schema=tenants.rows[0]?.esquema_datos,pharmacies=ph.rows;
 if(!/^[a-z][a-z0-9_]{1,62}$/.test(schema||""))throw Error("Tenant no disponible");
 const ctx={client:{slug:"ampedia",schema},pharmacies};
 const ids=pharmacies.map(p=>Number(p.id));result.pharmacies=ids.length;
 const selector=await measure("selectorCold",()=>listOperationalLaboratoryOptions(pool,ctx,ids));
 if(selector){result.labCount=selector.length;result.includesCinfa=selector.some(x=>x.key==="N:CINFA")}
 await measure("selectorWarm",()=>listOperationalLaboratoryOptions(pool,ctx,ids));
 // Medir la caché auténtica de endpoint por separado.
 const {readCachedLaboratoryOptions}=await import("./laboratoryOptionCache.js");
 await measure("cacheFill",()=>readCachedLaboratoryOptions(pool,"ampedia",ids,()=>
  listOperationalLaboratoryOptions(pool,ctx,ids)));
 await measure("cacheHit",()=>readCachedLaboratoryOptions(pool,"ampedia",ids,()=>
  listOperationalLaboratoryOptions(pool,ctx,ids)));
 const catalog=await measure("cinfaCatalog100",()=>readDirectLaboratoryCatalog(pool,ctx,{
  key:"N:CINFA",pharmacies:ids,type:"medicacion",page:1,size:100,skipMovementCheck:true
 }));
 if(catalog){result.cinfaTotal=catalog.total;
  const last=new Date(),until=last.toISOString().slice(0,10);
  const from=new Date(last.getTime()-30*86400000).toISOString().slice(0,10);
  const matrix=await measure("cinfaMetrics40",()=>readLaboratoryOrderMatrix(pool,ctx,{
   key:"N:CINFA",pharmacies:ids,type:"medicacion",from,to:until,
   prefetchedRows:catalog.rows.slice(0,40)
  }));
  if(matrix)result.metricsAvailable=!matrix.metricsUnavailable;
 }
}catch(e){result.error=e.code||e.name||"Error"}
finally{console.log("PREPARADOR_PERF_BENCH",JSON.stringify(result));await pool.end()}
