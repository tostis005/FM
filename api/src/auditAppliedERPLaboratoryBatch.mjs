// Auditoría de un lote CONCLUIDO, solo consulta; no modifica asociaciones.
import pg from "pg";
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1,query_timeout:60000,statement_timeout:60000});
const slug="ampedia",batch="fc96dd55-80a4-4c3b-a578-5499440c36e7",out={slug,batch,readonly:true};
try{
 const {rows}=await pool.query(`SELECT m.origen_id::text AS "fromId",s.nombre AS "fromName",
 m.destino_id::text AS "toId",t.nombre AS "toName",t.clase AS "targetClass",
 coalesce(aa.aliases,0)::int AS "movedAliases",
 coalesce(cn.refs,0)::int AS "cnRefs"
 FROM farmetrica.laboratorios_unificacion_origenes m
 JOIN farmetrica.proveedores_unificados s ON s.id=m.origen_id AND s.cliente_slug=$1
 JOIN farmetrica.proveedores_unificados t ON t.id=m.destino_id AND t.cliente_slug=$1
 LEFT JOIN LATERAL(
  SELECT count(*)::int AS aliases FROM farmetrica.laboratorios_unificacion_alias a
  WHERE a.lote=m.lote AND a.origen_id=m.origen_id
 ) aa ON true
 LEFT JOIN LATERAL(
  SELECT count(*)::int AS refs FROM farmetrica.preparador_ultima_recepcion_cache p
  WHERE p.cliente_slug=$1 AND p.lab_id=m.destino_id
 ) cn ON true
 WHERE m.lote=$2 ORDER BY t.nombre,s.nombre`,[slug,batch]);
 out.count=rows.length;out.items=rows;
}catch(e){out.error=e.code||e.name;out.detail=String(e.message).slice(0,200)}
finally{console.log("FM_AUDIT_LOTE_ERP",JSON.stringify(out));await pool.end()}
if(out.error)process.exitCode=1;
