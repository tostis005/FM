// Clasificación segura de fichas SIN_CLASIFICAR por nombre y evidencia ERP.
// Acciones: plan (solo lectura), apply (transacción auditada), rollback.
// No mueve alias ni elimina fichas; no reescribe recepciones/ventas ERP.
import pg from "pg";
import {randomUUID} from "node:crypto";
import {proposeSupplierClassifications} from "./supplierClassificationPolicy.js";
const slug="ampedia",criterion="proveedores-evidencia-nombres-v1-20261029";
const action=process.env.FM_PROVEEDORES_CLASIFICACION_ACTION||"plan";
if(!["plan","apply","rollback"].includes(action))throw Error("Acción inválida");
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1,
 connectionTimeoutMillis:5000,query_timeout:40000,statement_timeout:40000});
const out={slug,criterion,action,success:false};
let db,transaction=false;
try{
 db=await pool.connect();
 await db.query("BEGIN");transaction=true;
 await db.query("SET LOCAL lock_timeout='6000ms'");
 await db.query("SET LOCAL statement_timeout='40000ms'");
 if(action!=="plan")
  await db.query("SELECT pg_advisory_xact_lock(hashtext('fm:classify:'||$1))",[slug]);
 const {rows:master}=await db.query(`SELECT id::text,nombre AS name,
  clase AS class,activo AS active,actualizado_en AS updated
 FROM farmetrica.proveedores_unificados WHERE cliente_slug=$1
 ${action==="apply"?"FOR UPDATE":""}`,[slug]);
 const {rows:aliases}=await db.query(`SELECT proveedor_id::text AS supplier,
  farmacia_codigo AS "pharmacyCode",codigo_origen AS "sourceCode",
  nombre_origen AS "sourceName",procedencia AS provenance
 FROM farmetrica.proveedores_unificados_alias WHERE cliente_slug=$1`,[slug]);
 const totalBefore=master.filter(p=>p.active&&p.class==="SIN_CLASIFICAR").length;
 out.before=totalBefore;
 if(action==="rollback"){
  const {rows:batch}=await db.query(`SELECT id,revertido_en FROM farmetrica.proveedores_reclasificacion_lotes
   WHERE cliente_slug=$1 AND criterio=$2 FOR UPDATE`,[slug,criterion]);
  if(!batch.length)throw Error("No existe lote de clasificación para revertir");
  if(batch[0].revertido_en){out.alreadyReverted=true;out.reverted=0}
  else{
   const result=await db.query(`
    UPDATE farmetrica.proveedores_unificados p
    SET clase=c.clase_anterior,actualizado_en=now()
    FROM farmetrica.proveedores_reclasificacion_cambios c
    WHERE c.lote=$1 AND p.cliente_slug=$2 AND p.id=c.proveedor_id
     AND p.nombre=c.nombre AND p.clase=c.clase_nueva
     AND p.actualizado_en=c.actualizado_aplicacion AND p.activo
    RETURNING p.id`,[batch[0].id,slug]);
   const {rows:count}=await db.query(`
    SELECT count(*)::int AS total FROM farmetrica.proveedores_reclasificacion_cambios WHERE lote=$1`,
    [batch[0].id]);
   if(result.rowCount!==count[0].total)
    throw Error("Hubo ediciones posteriores: rollback parcial cancelado para no sobrescribirlas");
   await db.query(`UPDATE farmetrica.proveedores_reclasificacion_lotes
    SET revertido_en=now() WHERE id=$1`,[batch[0].id]);
   out.reverted=result.rowCount;
  }
 }else{
  const {operations,uncertain,skipped}=proposeSupplierClassifications(master,aliases);
  out.proposed=operations.length;out.remaining=uncertain.length+skipped.length;
  out.skippedManual=skipped.length;
  out.byClass=Object.fromEntries([...new Set(operations.map(x=>x.to))].map(c=>[
   c,operations.filter(x=>x.to===c).length]));
  out.byReason=Object.fromEntries([...new Set(operations.map(x=>x.reason))].map(c=>[
   c,operations.filter(x=>x.reason===c).length]));
  out.pendingExamples=uncertain.slice(0,120);
  out.proposedExamples=operations.filter(x=>x.to==="MAYORISTA"||x.to==="INTERNO"||x.to==="OTROS").slice(0,110);
  out.alliance=operations.filter(x=>/ALLIANCE HEALT/i.test(x.name));
  if(action==="apply"){
   const existing=await db.query(`SELECT id,revertido_en FROM farmetrica.proveedores_reclasificacion_lotes
    WHERE cliente_slug=$1 AND criterio=$2 FOR UPDATE`,[slug,criterion]);
   if(existing.rowCount){
    if(existing.rows[0].revertido_en)throw Error("Lote revertido: requiere nueva revisión");
    out.alreadyApplied=true;out.batch=existing.rows[0].id;
   }else{
    if(!operations.length)throw Error("Sin operaciones verificables");
    const batch=randomUUID();
    await db.query(`INSERT INTO farmetrica.proveedores_reclasificacion_lotes
     (id,cliente_slug,criterio) VALUES($1,$2,$3)`,[batch,slug,criterion]);
    for(const op of operations){
     const updated=await db.query(`
      UPDATE farmetrica.proveedores_unificados
      SET clase=$3,actualizado_en=clock_timestamp()
      WHERE cliente_slug=$1 AND id=$2 AND nombre=$4 AND activo
       AND clase='SIN_CLASIFICAR'
      RETURNING actualizado_en`,[slug,op.id,op.to,op.name]);
     if(updated.rowCount!==1)throw Error("Cambio concurrente en proveedor "+op.id);
     await db.query(`INSERT INTO farmetrica.proveedores_reclasificacion_cambios
      (lote,proveedor_id,nombre,clase_anterior,clase_nueva,razon,actualizado_aplicacion)
      VALUES($1,$2,$3,'SIN_CLASIFICAR',$4,$5,$6)`,
      [batch,op.id,op.name,op.to,op.reason,updated.rows[0].actualizado_en]);
    }
    out.applied=operations.length;out.batch=batch;
   }
  }
 }
 await db.query(action==="plan"?"ROLLBACK":"COMMIT");transaction=false;
 out.success=true;
}catch(e){if(transaction&&db)await db.query("ROLLBACK").catch(()=>{});
 out.error=e.code||e.name;out.detail=String(e.message).slice(0,250)}
finally{db?.release();await pool.end();
 console.log("FM_CLASIFICAR_PROVEEDORES",JSON.stringify(out))}
if(!out.success)process.exitCode=1;
