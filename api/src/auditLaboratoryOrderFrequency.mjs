// Diagnóstico puntual para configurar la agenda con la demanda real de CN.
// Usa el catálogo consolidado (una fila por CN asignado a la última recepción),
// no realiza lecturas históricas masivas ni modifica datos.
import pg from "pg";
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000,query_timeout:20000});
const slug="ampedia",result={slug,readonly:true};
try{
 const {rows}=await pool.query(`
 SELECT p.id::text AS id,p.nombre AS name,p.clase AS class,
  count(c.cn)::int AS cn,
  count(c.cn) FILTER(WHERE c.cn ~ '^[4-9][0-9]{5,6}$')::int AS meds,
  count(c.cn) FILTER(WHERE c.cn !~ '^[4-9][0-9]{5,6}$')::int AS para,
  count(DISTINCT f.id)::int AS farms,
  fr.intervalo_dias AS frequency,
  (SELECT count(*)::int FROM farmetrica.proveedores_unificados_alias a
   WHERE a.cliente_slug=p.cliente_slug AND a.proveedor_id=p.id) AS aliases
 FROM farmetrica.proveedores_unificados p
 LEFT JOIN farmetrica.preparador_ultima_recepcion_cache c
  ON c.cliente_slug=p.cliente_slug AND c.lab_id=p.id
 LEFT JOIN farmetrica.farmacias f ON f.cliente_slug=p.cliente_slug AND f.activo
  AND f.id=ANY(c.pharmacy_ids)
 LEFT JOIN farmetrica.preparador_frecuencia_laboratorio fr
  ON fr.cliente_slug=p.cliente_slug AND fr.laboratorio_clave='P:'||p.id::text
 WHERE p.cliente_slug=$1 AND p.activo
  AND p.clase IN ('DIRECTO','VACUNAS','FÓRMULAS')
 GROUP BY p.id,p.nombre,p.clase,fr.intervalo_dias,p.cliente_slug
 ORDER BY cn DESC,meds DESC,p.nombre`,[slug]);
 result.total=rows.length;result.withCn=rows.filter(x=>x.cn>0).length;
 result.configured=rows.filter(x=>x.frequency!==null).map(x=>({name:x.name,id:x.id,days:x.frequency,cn:x.cn}));
 result.distribution={
  over250:rows.filter(x=>x.cn>=250).length,
  over150:rows.filter(x=>x.cn>=150).length,
  over100:rows.filter(x=>x.cn>=100).length,
  over60:rows.filter(x=>x.cn>=60).length,
  over30:rows.filter(x=>x.cn>=30).length,
  over15:rows.filter(x=>x.cn>=15).length
 };
 result.active=rows.filter(x=>x.cn>0).slice(0,125);
}catch(e){result.error=e.code||e.name;result.detail=String(e.message).slice(0,180)}
finally{console.log("FM_AUDIT_FRECUENCIAS_LAB",JSON.stringify(result));await pool.end()}
if(result.error)process.exitCode=1;
