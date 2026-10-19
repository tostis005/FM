// Auditoría no destructiva para detectar dónde llegan realmente las
// recepciones/compras de los ERP. No mostrar nombres de pacientes,
 // artículos, proveedores, CN, importes ni ninguna línea individual.
import pg from "pg";
if(process.env.FM_BENCHMARK_READONLY!=="1")throw Error("Auditoría solo lectura obligatoria");
const db=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000});
try{
 await db.connect();
 await db.query("BEGIN READ ONLY");
 await db.query("SET LOCAL statement_timeout='12000ms'");
 await db.query("SET LOCAL lock_timeout='3000ms'");
 const {rows}=await db.query(`
 SELECT n.nspname AS schema,c.relname AS name,c.relkind AS kind,
  count(*) FILTER(WHERE a.attnum>0 AND NOT a.attisdropped)::int AS columns,
  coalesce(jsonb_agg(a.attname ORDER BY a.attnum)
   FILTER(WHERE a.attnum>0 AND NOT a.attisdropped),'[]'::jsonb) AS fields
 FROM pg_catalog.pg_class c
 JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid
 WHERE n.nspname NOT LIKE 'pg_%'
   AND n.nspname NOT IN ('information_schema')
   AND c.relkind IN ('r','p','v','m')
   AND (c.relname ~* '(recep|compr|albar|factur|entrad|pedido|linea|articul)'
    OR c.relname ~* '(stock|movim|proveed)')
 GROUP BY n.nspname,c.relname,c.relkind
 ORDER BY n.nspname,c.relname LIMIT 150`);
 for(const r of rows){
  const fields=r.fields.filter(x=>/^(id|cod|numero|fecha|provee|cant|unidad|precio|pu[cvm]|importe|total|artic|producto|factur|albar|recep|linea|farmacia|origen|descuent|base)/i.test(x));
  console.log("RECEPCION_ORIGEN_METADATA "+
    JSON.stringify({schema:r.schema,table:r.name,kind:r.kind,columns:r.columns,
     candidateFields:fields.slice(0,35)}));
 }
 const {rows:[source]}=await db.query(`
 SELECT count(*)::int AS source_rows,
 count(*) FILTER(WHERE articulo_id IS NOT NULL AND btrim(articulo_id)<>'')::int AS article_rows,
 count(*) FILTER(WHERE unidades IS NOT NULL)::int AS quantity_rows,
 count(*) FILTER(WHERE importe IS NOT NULL)::int AS amount_rows,
 count(*) FILTER(WHERE coste_unitario IS NOT NULL)::int AS priced_rows,
 count(DISTINCT farmacia_codigo)::int AS pharmacy_count,
 max(fecha)::date AS latest_date
 FROM ampedia.compras WHERE fecha >= current_date-interval '6 months'`);
 console.log("RECEPCIONES_AMPEDIA_CALIDAD "+JSON.stringify(source));
 await db.query("ROLLBACK");
}catch(e){console.log("RECEPCIONES_AUDITORIA_ERROR "+(e.code||e.name));process.exitCode=1;try{await db.query("ROLLBACK")}catch{}}
finally{await db.end()}
