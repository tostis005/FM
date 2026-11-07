// Auditoría de solo lectura del catálogo después de importar/reimportar.
// No extrae nombres comerciales, CN, usuarios ni cifras de stock.
import pg from "pg";
if(process.env.FM_PROMOTION_VISIBILITY_20261107!=="1")throw Error("Activación explícita requerida");
if(!process.env.DATABASE_URL)throw Error("PostgreSQL no disponible");
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1,
 connectionTimeoutMillis:5000,statement_timeout:14000,query_timeout:14000,
 options:"-c default_transaction_read_only=on -c lock_timeout=3s"});
try{
 const {rows:clients}=await pool.query(
  "SELECT esquema_datos AS schema FROM farmetrica.clientes WHERE slug=$1",["ampedia"]);
 const schema=clients[0]?.schema;
 if(!/^[a-z][a-z0-9_]{1,62}$/.test(schema||""))throw Error("Esquema no válido");
 const {rows}=await pool.query({text:`
 SELECT count(*)::int AS total_catalog,
 count(*) FILTER (WHERE documento->>'source' ILIKE $1)::int AS november_excel,
 count(*) FILTER (WHERE documento->>'source' ILIKE $1
    AND documento->>'start' SIMILAR TO '2026-11-%')::int AS starts_in_november,
 count(*) FILTER (WHERE documento->>'source' ILIKE $1
    AND coalesce(documento->>'start','')='')::int AS missing_start,
 count(*) FILTER (WHERE documento->>'source' ILIKE $1
    AND (documento->>'importedOn') LIKE '2026-11-%')::int AS uploaded_in_november,
 count(*) FILTER (WHERE documento->>'source' ILIKE $1
    AND coalesce(documento->'targets','{}'::jsonb)='{}'::jsonb)::int AS without_targets,
 count(DISTINCT documento->>'importBatchId')
   FILTER (WHERE documento->>'source' ILIKE $1)::int AS distinct_batches,
 count(*) FILTER (WHERE documento->>'start' LIKE '2026-11-%'
    OR documento->>'end' LIKE '2026-11-%')::int AS any_date_in_november
 FROM "${schema}".fm_promociones`,
 values:["Excel: NOVIEMBRE 2026 PROMOCIONES FARMACIA ABADIA Y PB%"],
 query_timeout:12000});
 console.log("PROMOTION_VISIBILITY_NOV_OK",JSON.stringify(rows[0]||{}));
}catch(error){
 console.error("PROMOTION_VISIBILITY_NOV_FAIL",error.code||error.name||"ERROR");
 process.exitCode=1;
}finally{await pool.end();}
