// Garantiza la conciliación de laboratorios pendiente en cualquier despliegue
// exitoso de main. Idempotente: no vuelve a tocar los alias ya reconciliados.
// El lote v3 de cuatro laboratorios revisados nunca se modifica aquí.
import pg from "pg";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const slug="ampedia";
const oldCriterion="unclassified-verified-laboratory-aliases-v4-20261029";
const cleanCriterion="unclassified-filtered-laboratories-v5-20261029";
const oldBatch="fc96dd55-80a4-4c3b-a578-5499440c36e7";
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1,
 connectionTimeoutMillis:5000,query_timeout:15000,statement_timeout:15000});
const log={slug,action:"ensure"};
async function currentState(){
 const {rows}=await pool.query(`SELECT criterio,lote::text,revertido_en
 FROM farmetrica.laboratorios_unificacion_lotes
 WHERE cliente_slug=$1 AND criterio=ANY($2::text[])`,[slug,[oldCriterion,cleanCriterion]]);
 return new Map(rows.map(x=>[x.criterio,x]));
}
function execute(filename,env={},timeout=600000){
 execFileSync(process.execPath,[fileURLToPath(new URL(filename,import.meta.url))],{
  env:{...process.env,...env},stdio:"inherit",timeout});
}
try{
 const initial=await currentState();
 const before=initial.get(oldCriterion),clean=initial.get(cleanCriterion);
 if(clean){
  if(clean.revertido_en)throw Error("La versión depurada figura revertida; requiere revisión");
  log.alreadyDone=true;log.batch=clean.lote;
 }else{
  if(!before||before.lote!==oldBatch)
   throw Error("El lote histórico de proveedores no coincide: abortar conciliación");
  // Desactivar antes cualquier asociación amplia que contenga proveedores
  // de servicios. Si ya se había revertido, la acción es un no-op seguro.
  execute("./applyLaboratoryMerges.mjs",{
   FM_LAB_MERGE_ACTION:"rollback",FM_LAB_MERGE_BATCH_ID:oldBatch},180000);
  const afterRollback=await currentState();
  if(!afterRollback.get(oldCriterion)?.revertido_en)
   throw Error("Rollback no confirmado en base de datos");
  // El conjunto de laboratorios con recepciones debe calcularse de nuevo
  // después del rollback; la nueva conciliación solo acepta targets con CN.
  execute("./refreshPreparadorLastReceipt.mjs",{},430000);
  execute("./applyLaboratoryMerges.mjs",{
   FM_LAB_MERGE_ACTION:"apply",FM_LAB_MERGE_MODE:"unclassified_v5"},180000);
  const checked=await currentState();
  if(!checked.get(cleanCriterion)||checked.get(cleanCriterion).revertido_en)
   throw Error("No consta un lote v5 aplicado");
  execute("./refreshPreparadorLastReceipt.mjs",{},430000);
  log.reconciled=true;log.batch=checked.get(cleanCriterion).lote;
 }
 const {rows:counts}=await pool.query(`SELECT
  (SELECT count(*)::int FROM farmetrica.laboratorios_unificacion_origenes s
   WHERE s.lote=$2::uuid) AS "linkedGroups",
  (SELECT count(*)::int FROM farmetrica.laboratorios_unificacion_alias a
   WHERE a.lote=$2::uuid) AS "linkedAliases",
  (SELECT count(*)::int FROM farmetrica.proveedores_unificados p
   WHERE p.cliente_slug=$1 AND p.activo AND p.clase='SIN_CLASIFICAR') AS "remainingUnclassified",
  (SELECT count(*)::int FROM farmetrica.preparador_ultima_recepcion_cache c
   WHERE c.cliente_slug=$1) AS "cnRows"`,
  [slug,log.batch]);
 Object.assign(log,counts[0]);log.success=true;
}catch(e){log.error=e.code||e.name||"Error";log.detail=String(e.message||"").slice(0,220)}
finally{await pool.end();console.log("FM_GARANTIZAR_LABS",JSON.stringify(log))}
if(!log.success)process.exitCode=1;
