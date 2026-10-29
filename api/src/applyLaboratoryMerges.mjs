// Ejecutar de manera puntual, con auditoría previa. Solo unifica las
// coincidencias estructurales inequívocas de laboratorio en el maestro.
// Nunca reescribe compras, recepciones, ventas ni CN.
import pg from "pg";
import {randomUUID} from "node:crypto";
import {proposeLaboratoryMerges} from "./laboratoryMergeCandidates.js";
import {proposeEvidenceLaboratoryMerges} from "./laboratoryMergeEvidence.js";
import {reviewedLaboratoryMerges} from "./laboratoryReviewedMerges.js";
import {planUnclassifiedLaboratoryAliases} from "./laboratoryUnclassifiedReconcile.js";
import {verifiedNonLabExclusions} from "./laboratoryNonLabExclusions.js";
import {planAdditionalVerifiedLaboratoryAliases} from "./laboratoryAdditionalVerified.js";
const clientSlug="ampedia";
const evidenceMode=process.env.FM_LAB_MERGE_MODE==="evidence_v2";
const reviewedMode=process.env.FM_LAB_MERGE_MODE==="reviewed_v3";
const additionalMode=process.env.FM_LAB_MERGE_MODE==="additional_v6";
const filteredMode=process.env.FM_LAB_MERGE_MODE==="unclassified_v5";
const unclassifiedMode=filteredMode||process.env.FM_LAB_MERGE_MODE==="unclassified_v4";
const criterion=additionalMode?"additional-reviewed-manufacturers-v6-20261029":
 filteredMode?"unclassified-filtered-laboratories-v5-20261029":
 unclassifiedMode?"unclassified-verified-laboratory-aliases-v4-20261029":
 reviewedMode?"reviewed-laboratories-v3-20261029":
 evidenceMode?"name-and-shared-erp-code-v2-20261029":"structural-laboratory-name-v1-20261028";
const applying=process.env.FM_LAB_MERGE_ACTION==="apply";
const rollingBack=process.env.FM_LAB_MERGE_ACTION==="rollback";
if(!applying&&!rollingBack)throw Error("Definir FM_LAB_MERGE_ACTION=apply o rollback");
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1,
 connectionTimeoutMillis:5000,query_timeout:120000,statement_timeout:120000});
const log={client:clientSlug,action:process.env.FM_LAB_MERGE_ACTION};
const db=await pool.connect();
try{
 await db.query("BEGIN");
 await db.query("SELECT pg_advisory_xact_lock(hashtext('fm:labs:'||$1))",[clientSlug]);
 await db.query(`CREATE TABLE IF NOT EXISTS farmetrica.laboratorios_unificacion_lotes (
  lote uuid PRIMARY KEY,cliente_slug text NOT NULL,criterio text NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now(),revertido_en timestamptz,
  UNIQUE(cliente_slug,criterio)
 )`);
 await db.query(`CREATE TABLE IF NOT EXISTS farmetrica.laboratorios_unificacion_origenes (
  lote uuid NOT NULL REFERENCES farmetrica.laboratorios_unificacion_lotes(lote),
  origen_id bigint NOT NULL,destino_id bigint NOT NULL,activo_anterior boolean NOT NULL,
  PRIMARY KEY(lote,origen_id)
 )`);
 await db.query(`CREATE TABLE IF NOT EXISTS farmetrica.laboratorios_unificacion_alias (
  lote uuid NOT NULL REFERENCES farmetrica.laboratorios_unificacion_lotes(lote),
  alias_id bigint NOT NULL,origen_id bigint NOT NULL,destino_id bigint NOT NULL,
  PRIMARY KEY(lote,alias_id)
 )`);
 if(applying){
  const prior=await db.query(`SELECT lote,creado_en
   FROM farmetrica.laboratorios_unificacion_lotes
   WHERE cliente_slug=$1 AND criterio=$2`,[clientSlug,criterion]);
  if(prior.rowCount){log.alreadyApplied=true;log.batch=prior.rows[0].lote}
  else{
   // El bloqueo de filas evita recalcular sobre cambios simultáneos del maestro.
   const {rows:master}=await db.query(`SELECT id::text,nombre AS name,
    clase AS class,activo AS active
    FROM farmetrica.proveedores_unificados WHERE cliente_slug=$1 FOR UPDATE`,[clientSlug]);
   const {rows:aliases}=await db.query(`SELECT id,proveedor_id::text AS supplier,
    procedencia,farmacia_codigo AS "pharmacyCode",codigo_origen AS "sourceCode"
    FROM farmetrica.proveedores_unificados_alias
    WHERE cliente_slug=$1 FOR UPDATE`,[clientSlug]);
   const sizes=new Map(),manual=new Set();
   for(const a of aliases){
    sizes.set(a.supplier,(sizes.get(a.supplier)||0)+1);
    if(a.procedencia==="manual")manual.add(a.supplier);
   }
   const blocked=new Set();
   let evidence=[];
   if(evidenceMode||reviewedMode||unclassifiedMode||additionalMode){
    // No fusionar automáticamente laboratorios con agenda, borrador o pedido real:
    // requieren elegir qué frecuencia/historial conservar.
    const {rows:used}=await db.query(`
     SELECT laboratorio_clave AS key FROM farmetrica.preparador_frecuencia_laboratorio
     WHERE cliente_slug=$1 AND laboratorio_clave LIKE 'P:%'
     UNION ALL SELECT laboratorio_clave FROM farmetrica.pedidos_laboratorio_borradores
     WHERE cliente_slug=$1 AND laboratorio_clave LIKE 'P:%'
     UNION ALL SELECT 'P:'||laboratorio_id::text FROM farmetrica.preparador_pedidos_realizados
     WHERE cliente_slug=$1`,[clientSlug]);
    for(const u of used)if(/^P:[1-9]\d*$/.test(u.key))blocked.add(u.key.slice(2));
    const {rows:origin}=await db.query(`SELECT proveedor_id::text AS supplier,
     farmacia_codigo AS "pharmacyCode",codigo_origen AS "sourceCode"
     FROM farmetrica.proveedores_unificados_alias WHERE cliente_slug=$1`,[clientSlug]);
    evidence=origin;
   }
   let activeLabIds=new Set(),unclassifiedReport=null;
   if(unclassifiedMode){
    if(filteredMode){
     const {rows:previous}=await db.query(`SELECT revertido_en
      FROM farmetrica.laboratorios_unificacion_lotes
      WHERE cliente_slug=$1 AND criterio='unclassified-verified-laboratory-aliases-v4-20261029'`,
      [clientSlug]);
     if(previous.length!==1||!previous[0].revertido_en)
      throw Error("El lote anterior aún no se ha revertido. No iniciar la conciliación filtrada.");
    }
    const {rows:lab}=await db.query(`SELECT DISTINCT lab_id::text AS id
     FROM farmetrica.preparador_ultima_recepcion_cache WHERE cliente_slug=$1`,
     [clientSlug]);
    activeLabIds=new Set(lab.map(r=>r.id));
    if(!activeLabIds.size)throw Error("No existe snapshot de laboratorios para verificar los orígenes");
    const excludes=filteredMode?verifiedNonLabExclusions(master):new Set();
    unclassifiedReport=planUnclassifiedLaboratoryAliases(master,aliases,activeLabIds,manual,blocked,excludes);
   }
   const {operations,review}=additionalMode?
    planAdditionalVerifiedLaboratoryAliases(master,aliases,manual,blocked):
    unclassifiedMode?unclassifiedReport:
    reviewedMode?reviewedLaboratoryMerges(master,evidence,manual,blocked):
    evidenceMode?proposeEvidenceLaboratoryMerges(master,evidence,manual,blocked):
    proposeLaboratoryMerges(master,sizes,manual);
   const batch=randomUUID();
   await db.query(`INSERT INTO farmetrica.laboratorios_unificacion_lotes
    (lote,cliente_slug,criterio) VALUES($1,$2,$3)`,[batch,clientSlug,criterion]);
   if(operations.length){
    await db.query(`CREATE TEMP TABLE fm_lab_merge_pairs(
     source_id bigint NOT NULL PRIMARY KEY,target_id bigint NOT NULL) ON COMMIT DROP`);
    await db.query(`INSERT INTO fm_lab_merge_pairs
     SELECT source_id::bigint,target_id::bigint FROM jsonb_to_recordset($1::jsonb)
     AS p(source_id text,target_id text)`,
     [JSON.stringify(operations.map(x=>({source_id:x.from,target_id:x.to})))]);
    const sourceCount=await db.query(`INSERT INTO farmetrica.laboratorios_unificacion_origenes
     (lote,origen_id,destino_id,activo_anterior)
     SELECT $1,m.source_id,m.target_id,s.activo
     FROM fm_lab_merge_pairs m
     JOIN farmetrica.proveedores_unificados s ON s.id=m.source_id AND s.cliente_slug=$2
     JOIN farmetrica.proveedores_unificados t ON t.id=m.target_id AND t.cliente_slug=$2
     WHERE s.activo=true AND t.activo=true
      AND (s.clase=t.clase OR ($3::boolean AND s.clase='SIN_CLASIFICAR'
       AND t.clase IN ('DIRECTO','VACUNAS','FÓRMULAS')))
     RETURNING origen_id`,[batch,clientSlug,unclassifiedMode||additionalMode]);
    if(sourceCount.rowCount!==operations.length)throw Error("Cambió el maestro: no se permite aplicar asociaciones incompletas");
    const moved=await db.query(`INSERT INTO farmetrica.laboratorios_unificacion_alias
     (lote,alias_id,origen_id,destino_id)
     SELECT $1,a.id,a.proveedor_id,m.target_id
     FROM farmetrica.proveedores_unificados_alias a
     JOIN fm_lab_merge_pairs m ON m.source_id=a.proveedor_id
     WHERE a.cliente_slug=$2 RETURNING alias_id`,[batch,clientSlug]);
    const upd=await db.query(`UPDATE farmetrica.proveedores_unificados_alias a
     SET proveedor_id=m.target_id,actualizado_en=now()
     FROM fm_lab_merge_pairs m
     WHERE a.cliente_slug=$1 AND a.proveedor_id=m.source_id RETURNING a.id`,[clientSlug]);
    if(upd.rowCount!==moved.rowCount)throw Error("Alias modificados durante la transacción");
    const groups=await db.query(`UPDATE farmetrica.proveedores_unificados p
     SET activo=false,fusionado_a=m.target_id,actualizado_en=now() FROM fm_lab_merge_pairs m
     WHERE p.cliente_slug=$1 AND p.id=m.source_id AND p.activo=true
     RETURNING p.id`,[clientSlug]);
    if(groups.rowCount!==operations.length)throw Error("No se desactivaron todos los grupos duplicados");
    log.movedAliases=moved.rowCount;
    log.mergedGroups=groups.rowCount;
   }else{log.movedAliases=0;log.mergedGroups=0}
   log.reviewGroups=review.length;
   log.evidenceMode=evidenceMode;
   log.reviewedMode=reviewedMode;
   log.unclassifiedMode=unclassifiedMode;
   log.filteredMode=filteredMode;
   log.additionalMode=additionalMode;
   if(unclassifiedReport)log.unclassifiedStatus=unclassifiedReport.status;
   log.examples=operations.slice(0,25).map(x=>({from:x.fromName,to:x.toName,codes:x.matchingCodes||[]}));
   log.reviewReasons=Object.fromEntries([...new Set(review.map(x=>x.reason))].map(reason=>[reason,review.filter(x=>x.reason===reason).length]));
   log.batch=batch;
  }
 }else{
  const wanted=process.env.FM_LAB_MERGE_BATCH_ID;
  if(!/^[a-f0-9-]{36}$/i.test(wanted||""))throw Error("FM_LAB_MERGE_BATCH_ID requerido");
  const {rows:b}=await db.query(`SELECT lote,revertido_en FROM farmetrica.laboratorios_unificacion_lotes
   WHERE lote=$1 AND cliente_slug=$2 FOR UPDATE`,[wanted,clientSlug]);
  if(b.length!==1)throw Error("Lote inexistente");
  if(b[0].revertido_en){
   log.batch=wanted;log.alreadyRolledBack=true;
  }else{
  const {rows:entries}=await db.query(`SELECT alias_id,origen_id,destino_id FROM
   farmetrica.laboratorios_unificacion_alias WHERE lote=$1`,[wanted]);
  const changed=await db.query(`SELECT count(*)::int AS count
   FROM farmetrica.laboratorios_unificacion_alias saved
   JOIN farmetrica.proveedores_unificados_alias a ON a.id=saved.alias_id
   WHERE saved.lote=$1 AND a.cliente_slug=$2 AND a.proveedor_id=saved.destino_id`,[wanted,clientSlug]);
  if(changed.rows[0].count!==entries.length)
   throw Error("Hay alias modificados desde la fusión; rollback automático cancelado");
  const reverted=await db.query(`UPDATE farmetrica.proveedores_unificados_alias a
   SET proveedor_id=s.origen_id,actualizado_en=now()
   FROM farmetrica.laboratorios_unificacion_alias s
   WHERE s.lote=$1 AND s.alias_id=a.id AND a.cliente_slug=$2 AND a.proveedor_id=s.destino_id
   RETURNING a.id`,[wanted,clientSlug]);
  const groups=await db.query(`UPDATE farmetrica.proveedores_unificados p
   SET activo=s.activo_anterior,fusionado_a=NULL,actualizado_en=now()
   FROM farmetrica.laboratorios_unificacion_origenes s
   WHERE s.lote=$1 AND s.origen_id=p.id AND p.cliente_slug=$2
   RETURNING p.id`,[wanted,clientSlug]);
  await db.query(`UPDATE farmetrica.laboratorios_unificacion_lotes
   SET revertido_en=now() WHERE lote=$1`,[wanted]);
  log.batch=wanted;log.restoredAliases=reverted.rowCount;log.restoredGroups=groups.rowCount;
  }
 }
 await db.query("COMMIT");
 log.success=true;
}catch(e){await db.query("ROLLBACK").catch(()=>{});log.error=e.code||e.name||"Error";log.detail=String(e.message||"").slice(0,180)}
finally{console.log("FM_UNIFICAR_LABORATORIOS",JSON.stringify(log));db.release();await pool.end()}
if(!log.success)process.exitCode=1;
