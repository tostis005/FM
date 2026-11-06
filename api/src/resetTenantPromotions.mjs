// Reinicio explícito, reversible desde revisiones, del catálogo de promociones
// de Ampedia. No toca artículos, ventas, tickets, proveedores ni objetivos externos.
// El flujo está protegido por dos banderas, transacción y advisory lock.
import pg from "pg";
if(process.env.FM_PROMOTION_RESET_CLIENT!=="ampedia"||
 process.env.FM_PROMOTION_RESET_CONFIRM!=="BORRAR_TODAS_AMPEDIA_20261106")
 throw Error("Reinicio no autorizado");
if(!process.env.DATABASE_URL)throw Error("DATABASE_URL no configurado");
const client=new pg.Client({connectionString:process.env.DATABASE_URL,
 connectionTimeoutMillis:5000,query_timeout:30000,statement_timeout:30000,
 options:"-c lock_timeout=3s"});
let open=false;
try{
 await client.connect();
 await client.query("BEGIN");open=true;
 await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",["fm-promotion-import-ampedia"]);
 const {rows:schemas}=await client.query(
  "SELECT esquema_datos FROM farmetrica.clientes WHERE slug=$1",["ampedia"]);
 if(schemas.length!==1||!/^[a-z][a-z0-9_]{1,62}$/.test(schemas[0].esquema_datos))
  throw Error("Esquema de cliente no válido");
 const schema=schemas[0].esquema_datos;
 const {rows:before}=await client.query('SELECT count(*)::int AS n FROM "'+schema+'".fm_promociones');
 const {rows:deleted}=await client.query(`
  WITH removed AS (
   DELETE FROM "${schema}".fm_promociones RETURNING id,documento
  ), logged AS (
   INSERT INTO "${schema}".fm_promocion_revisiones
    (promocion_id,documento_anterior,cambiado_por)
   SELECT id,documento||jsonb_build_object(
    'deletedAt',now()::text,
    'deletedReason','Reinicio completo autorizado del catálogo 2026-11-06'),
    'system:promotions-reset-20261106'
   FROM removed
   RETURNING promocion_id
  )
  SELECT (SELECT count(*)::int FROM removed) AS removed,
         (SELECT count(*)::int FROM logged) AS audited`);
 const {rows:after}=await client.query('SELECT count(*)::int AS n FROM "'+schema+'".fm_promociones');
 const initial=before[0].n,n=deleted[0].removed,audited=deleted[0].audited,remaining=after[0].n;
 if(initial!==n||n!==audited||remaining!==0)throw Error("Reinicio incompleto; se revierte toda la transacción");
 await client.query("COMMIT");open=false;
 console.log("PROMOCIONES_RESET_OK",JSON.stringify({client:"ampedia",before:initial,removed:n,audited,remaining}));
}catch(error){
 if(open)await client.query("ROLLBACK").catch(()=>{});
 console.error("PROMOCIONES_RESET_ERROR",error.code||error.name,error.message?.slice(0,120));
 process.exitCode=1;
}finally{await client.end();}
