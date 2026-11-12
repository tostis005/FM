// Precalentamiento auditado y de solo resumen; nunca modifica el ERP.
// Diagnóstico activado por despliegue: cache mensual y EXPLAIN sin importes.
import pg from "pg";
import {createSalesPanoramaCache} from "./salesPanorama.js";
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";

if(process.env.FM_PRECALENTAR_VENTAS!=="1")throw Error("Activación requerida");
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,
 max:2,connectionTimeoutMillis:10000,query_timeout:125000,statement_timeout:30000,
 options:"-c lock_timeout=5s"});
const maxDuration=Number(process.env.FM_PRECALENTAR_MAX_MS)||220000;
const started=Date.now();
const cache=createSalesPanoramaCache(pool);
const monthBefore=s=>{
 const d=new Date(s.slice(0,7)+"-01T00:00:00Z");
 d.setUTCMonth(d.getUTCMonth()-1);
 return d.toISOString().slice(0,10);
};
try{
 const {rows:timeRows}=await pool.query(
  "SELECT to_char(clock_timestamp() AT TIME ZONE 'Europe/Madrid','YYYY-MM-DD') AS today");
 const {rows:farms}=await pool.query(
  "SELECT f.id,c.slug,c.esquema_datos AS schema,"+pharmacyDataCodeSQL("f")+" AS code"+
  " FROM farmetrica.clientes c JOIN farmetrica.farmacias f ON f.cliente_slug=c.slug"+
  " WHERE c.slug='ampedia' AND c.activo AND f.activo"+
  " AND c.demo_origen_slug IS NULL ORDER BY f.id");
 const months=[];
 for(let month=monthBefore(timeRows[0].today),i=0;i<6;i++,month=monthBefore(month))
  months.push(month);
 let checked=0,ready=0;
 // Intercalar farmacias antes de retroceder otro mes: la vista por farmacia
 // alcanza pronto una cobertura útil y el proceso no satura PostgreSQL.
 for(const month of months){
  for(const f of farms){
   if(Date.now()-started>maxDuration){
    console.log("FM_PRECALENTAR_VENTAS_LIMIT",JSON.stringify({checked,ready}));
    process.exit(0);
   }
   const at=Date.now();
   const success=await cache.refreshMonth({slug:f.slug,schema:f.schema,
    id:Number(f.id),code:String(f.code||"").trim().toUpperCase(),month});
   checked++;if(success)ready++;
   console.log("FM_PRECALENTAR_VENTAS",JSON.stringify({mes:month,pharmacyId:f.id,
    ms:Date.now()-at,ok:success}));
  }
 }
 console.log("FM_PRECALENTAR_VENTAS_OK",JSON.stringify({checked,ready}));
}catch(error){
 console.error("FM_PRECALENTAR_VENTAS_ERROR",error.code||error.name);
 process.exitCode=1;
}finally{await pool.end()}
