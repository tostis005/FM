// Configuración inicial de frecuencias GLOBAL por laboratorio. Usa la
// instantánea de CN de última recepción (CN único entre todas las farmacias).
// Solo añade valores a laboratorios sin configuración manual previa.
// Se registra cada propuesta para no reconfigurar tras cambios del usuario.
import pg from "pg";
import {planGlobalFrequencies} from "./laboratoryFrequencyPolicy.js";
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1,
 connectionTimeoutMillis:5000,query_timeout:35000,statement_timeout:35000});
const slug="ampedia",criterion="cn-global-4-7-14-v1-20261029",log={slug,criterion};
let db;
try{
 db=await pool.connect();
 await db.query("BEGIN");
 await db.query("SET LOCAL lock_timeout='5000ms'");
 await db.query("SET LOCAL statement_timeout='35000ms'");
 const {rows:locked}=await db.query(
  "SELECT pg_try_advisory_xact_lock(hashtext($1),492714) AS locked",[slug]);
 if(!locked[0]?.locked)throw Error("La planificación ya está siendo actualizada");
 const {rows:cn}=await db.query(`
  SELECT p.id::text AS id,p.nombre AS name,p.clase AS class,
   count(DISTINCT c.cn)::int AS cn,fr.intervalo_dias AS "previousDays"
  FROM farmetrica.proveedores_unificados p
  JOIN farmetrica.preparador_ultima_recepcion_cache c
   ON c.cliente_slug=p.cliente_slug AND c.lab_id=p.id
  LEFT JOIN farmetrica.preparador_frecuencia_laboratorio fr
   ON fr.cliente_slug=p.cliente_slug AND fr.laboratorio_clave='P:'||p.id::text
  WHERE p.cliente_slug=$1 AND p.activo
   AND p.clase IN ('DIRECTO','VACUNAS','FÓRMULAS')
  GROUP BY p.id,p.nombre,p.clase,p.cliente_slug,fr.intervalo_dias
  ORDER BY cn DESC,p.nombre`,[slug]);
 if(!cn.length)throw Error("No hay CN consolidados: no se han cambiado frecuencias");
 const plan=planGlobalFrequencies(cn);
 const buckets={4:0,7:0,14:0,demanda:0},inserted={4:0,7:0,14:0};
 let preserved=0,excluded=0,unchanged=0;
 const details=[];
 for(const p of plan){
  const interval=p.suggested;
  buckets[interval??"demanda"]++;
  if(p.excluded)excluded++;
  if(p.previousDays!==null){preserved++;continue}
  // Solo guardar una vez cada recomendación. Incluso si el usuario
  // posteriormente desactiva un laboratorio, no volver a activar.
  const {rows:tracked}=await db.query(`
   INSERT INTO farmetrica.preparador_frecuencia_propuesta
    (cliente_slug,laboratorio_id,criterio,cn_unicos,frecuencia_propuesta,frecuencia_anterior,aplicada)
   VALUES($1,$2,$3,$4,$5,NULL,false)
   ON CONFLICT DO NOTHING RETURNING laboratorio_id`,
   [slug,p.id,criterion,p.cn,interval]);
  if(!tracked.length){unchanged++;continue}
  if(interval===null)continue;
  const res=await db.query(`
   INSERT INTO farmetrica.preparador_frecuencia_laboratorio
    (cliente_slug,laboratorio_clave,intervalo_dias)
   VALUES($1,'P:'||$2::text,$3)
   ON CONFLICT DO NOTHING RETURNING intervalo_dias`,[slug,p.id,interval]);
  if(res.rowCount){
   inserted[interval]++;
   details.push({id:p.id,name:p.name,cn:p.cn,days:interval});
   await db.query(`UPDATE farmetrica.preparador_frecuencia_propuesta
    SET aplicada=true WHERE cliente_slug=$1 AND laboratorio_id=$2 AND criterio=$3`,
    [slug,p.id,criterion]);
  }
 }
 log.cnLabCount=cn.length;log.distribution=buckets;log.saved=inserted;
 log.scheduledTotal=Object.values(inserted).reduce((a,b)=>a+b,0);
 log.preservedManual=preserved;log.excludedNonLabs=excluded;log.alreadyTracked=unchanged;
 log.cinfa=plan.find(x=>/\bCINFA\b/i.test(x.name))||null;
 log.top=details.sort((a,b)=>a.days-b.days||b.cn-a.cn).slice(0,45);
 await db.query("COMMIT");log.success=true;
}catch(e){if(db)await db.query("ROLLBACK").catch(()=>{});log.error=e.code||e.name;log.detail=String(e.message).slice(0,180)}
finally{db?.release();await pool.end();console.log("FM_FRECUENCIAS_GLOBALES",JSON.stringify(log))}
if(!log.success)process.exitCode=1;
