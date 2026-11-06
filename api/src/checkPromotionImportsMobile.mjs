// Diagnóstico sin escritura ni datos comerciales: detectar si el Excel de
// noviembre ya se guardó aunque los filtros ocultaran sus borradores.
import pg from "pg";
if(!process.env.DATABASE_URL)throw Error("Base de datos no disponible");
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1,
 connectionTimeoutMillis:4500,statement_timeout:8500,query_timeout:9000,
 options:"-c default_transaction_read_only=on -c lock_timeout=3s"});
try{
 const {rows:clients}=await pool.query({
  text:"SELECT esquema_datos AS schema FROM farmetrica.clientes WHERE slug=$1",
  values:["ampedia"],query_timeout:5000});
 const schema=clients[0]?.schema;
 if(!/^[a-z][a-z0-9_]{1,62}$/.test(schema||""))
  throw Error("No se encontró el esquema de la cuenta");
 const {rows}=await pool.query({text:
  'SELECT count(*)::int AS campaigns,'+
  ' count(DISTINCT documento->>\'importBatchId\')::int AS batches,'+
  ' count(*) FILTER (WHERE coalesce(documento->\'targets\',\'{}\'::jsonb)=\'{}\'::jsonb)::int AS drafts_without_pharmacies,'+
  ' count(*) FILTER (WHERE actualizado_en>=now()-interval \'24 hours\')::int AS imported_last_24h'+
  ' FROM "'+schema+'".fm_promociones WHERE documento->>\'source\' ILIKE $1',
  values:["Excel: NOVIEMBRE 2026 PROMOCIONES FARMACIA ABADIA Y PB%"],query_timeout:8000});
 console.log("PROMOCIONES_NOVIEMBRE_ESTADO",JSON.stringify(rows[0]||{}));

 // Solo estadísticas agregadas: no extraer CN, descripciones ni usuarios.
 // Distinguir campañas duplicadas por fila (mismo Excel), y duplicados
 // exactos que también contienen el mismo listado CN.
 const {rows:duplicateRows}=await pool.query({text:
  'WITH imports AS ('+
  ' SELECT documento->>\'importBatchId\' AS batch,'+
  ' md5(jsonb_build_array(documento->>\'source\',documento->>\'sourceSheet\','+
  ' documento->>\'sourceRow\',documento->>\'laboratory\','+
  ' documento->>\'range\',documento->>\'originalOffer\','+
  ' documento->>\'start\',documento->>\'end\')::text) AS rowkey,'+
  ' md5(jsonb_build_array(documento->>\'source\',documento->>\'sourceSheet\','+
  ' documento->>\'sourceRow\',documento->>\'laboratory\','+
  ' documento->>\'range\',documento->>\'originalOffer\','+
  ' documento->>\'start\',documento->>\'end\',documento->\'cns\')::text) AS contentkey'+
  ' FROM "'+schema+'".fm_promociones WHERE documento->>\'source\' ILIKE $1),'+
  ' rows_by_identity AS (SELECT rowkey,count(*) n FROM imports GROUP BY rowkey),'+
  ' rows_by_content AS (SELECT contentkey,count(*) n FROM imports GROUP BY contentkey),'+
  ' batches AS (SELECT batch,count(*) n FROM imports GROUP BY batch)'+
  ' SELECT (SELECT count(*)::int FROM rows_by_identity) AS distinct_rows,'+
  ' (SELECT coalesce(sum(n-1),0)::int FROM rows_by_identity WHERE n>1) AS duplicate_rows,'+
  ' (SELECT coalesce(sum(n-1),0)::int FROM rows_by_content WHERE n>1) AS exact_duplicate_rows,'+
  ' (SELECT coalesce(jsonb_agg(n ORDER BY n),\'[]\'::jsonb) FROM batches) AS batch_sizes',
  values:["Excel: NOVIEMBRE 2026 PROMOCIONES FARMACIA ABADIA Y PB%"],query_timeout:8000});
 console.log("PROMOCIONES_NOVIEMBRE_DUPLICADOS",JSON.stringify(duplicateRows[0]||{}));
}catch(error){
 console.error("PROMOCIONES_NOVIEMBRE_ESTADO_ERROR",error.code||error.name);
 process.exitCode=1;
}finally{await pool.end();}
