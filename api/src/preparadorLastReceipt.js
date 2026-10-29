// Modo reversible del preparador: sólo el laboratorio de la última
// recepción positiva válida de cada CN. No modifica datos de Farmatic.
import {readFile} from "node:fs/promises";
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
import {readRetirementPatterns} from "./laboratoryRetirements.js";
import {invalidateCachedLaboratoryOptions} from "./laboratoryOptionCache.js";
const SQL=await readFile(new URL("./preparadorLastReceipt.sql",import.meta.url),"utf8");
const SNAPSHOT_SQL=(await readFile(new URL("./preparadorLastReceiptSnapshot.sql",import.meta.url),"utf8"))
 .trim().replace(/;\s*$/,"");
const STALE_MS=15*60*1000;
const refreshes=new WeakMap();
const CACHE_MS=120_000;
const caches=new WeakMap();
export const lastReceiptMode=()=>process.env.FM_PREPARADOR_ULTIMA_RECEPCION!=="0";
export function invalidateLastReceiptCache(pool,slug){
 const cache=caches.get(pool);
 if(cache)for(const key of cache.keys())if(key.startsWith(slug+"|"))cache.delete(key);
 // Los cambios de clasificación/manuales recalculan fuera de la petición
 // que guarda el maestro; nunca hacen esperar al usuario que edita.
 if(typeof pool.connect!=="function"||typeof pool.totalCount!=="number")return;
 void pool.query("SELECT esquema_datos FROM farmetrica.clientes WHERE slug=$1",[slug])
  .then(({rows})=>{
   const schema=rows[0]?.esquema_datos;
   if(/^[a-z][a-z0-9_]{1,62}$/.test(schema||""))
    return refreshLastReceiptSnapshot(pool,{client:{slug,schema}});
  }).catch(error=>console.warn("PREPARADOR_SNAPSHOT_INVALIDATE",error.code||error.name));
}

/** Recalcular en segundo plano sin bloquear las lecturas: transacción atómica.
 * El bloqueo consultivo evita duplicar trabajos entre varias réplicas.
 */
export function refreshLastReceiptSnapshot(pool,ctx){
 const {slug,schema}=ctx.client;
 if(!/^[a-z][a-z0-9_]{1,62}$/.test(schema)||!slug)
  return Promise.reject(Error("Esquema inválido"));
 let byTenant=refreshes.get(pool);
 if(!byTenant){byTenant=new Map();refreshes.set(pool,byTenant)}
 if(byTenant.has(slug))return byTenant.get(slug);
 const pending=(async()=>{
  const client=await pool.connect();
  let acquired=false,transaction=false;
  const started=Date.now();
  try{
   const lock=await client.query(
    "SELECT pg_try_advisory_lock(731234,hashtext($1::text)) AS acquired",[slug]);
   acquired=lock.rows[0]?.acquired===true;
   if(!acquired)return {skipped:true};
   const patterns=await readRetirementPatterns(client,slug);
   const text=SNAPSHOT_SQL.replaceAll("__SCHEMA__",'"'+schema+'"')
    .replaceAll("__PHARMACY_CODE__",pharmacyDataCodeSQL("f"));
   await client.query("BEGIN");transaction=true;
   // El pool HTTP tiene statement_timeout=30s. Este trabajo se ejecuta
   // fuera de la petición y necesita su propio límite, solo en esta transacción.
   await client.query("SET LOCAL statement_timeout = '360s'");
   await client.query(
    "DELETE FROM farmetrica.preparador_ultima_recepcion_cache WHERE cliente_slug=$1",[slug]);
   const result=await client.query({text:`
    INSERT INTO farmetrica.preparador_ultima_recepcion_cache
     (cliente_slug,lab_id,cn,nombre,pharmacy_ids,blocked_pharmacy_ids)
    SELECT $1::text,s.lab_id::bigint,s.cn,s.nombre,
     s.pharmacy_ids,s.blocked_pharmacy_ids FROM (${text}) s`,
    values:[slug,patterns],query_timeout:360000});
   await client.query(`
    INSERT INTO farmetrica.preparador_ultima_recepcion_estado
     (cliente_slug,actualizado_en) VALUES($1,now())
    ON CONFLICT(cliente_slug) DO UPDATE SET actualizado_en=EXCLUDED.actualizado_en`,
   [slug]);
   await client.query("COMMIT");transaction=false;
   const cache=caches.get(pool);
   if(cache)for(const key of cache.keys())if(key.startsWith(slug+"|"))cache.delete(key);
   invalidateCachedLaboratoryOptions(pool,slug);
   console.info("PREPARADOR_SNAPSHOT",JSON.stringify({
    status:"ok",elapsedMs:Date.now()-started,references:result.rowCount}));
   return {updated:true,references:result.rowCount};
  }catch(error){
   if(transaction)await client.query("ROLLBACK").catch(()=>{});
   console.warn("PREPARADOR_SNAPSHOT",JSON.stringify({
    status:"error",elapsedMs:Date.now()-started,code:error.code||error.name}));
   throw error;
  }finally{
   if(acquired)await client.query(
    "SELECT pg_advisory_unlock(731234,hashtext($1::text))",[slug]).catch(()=>{});
   client.release();
  }
 })();
 byTenant.set(slug,pending);
 void pending.finally(()=>{if(byTenant.get(slug)===pending)byTenant.delete(slug)}).catch(()=>{});
 return pending;
}
export async function latestLaboratoryCN(pool,ctx,pharmacies){
 if(!/^[a-z][a-z0-9_]{1,62}$/.test(ctx.client.schema))throw Error("Esquema inválido");
 const ids=[...new Set(pharmacies.map(Number))].sort((a,b)=>a-b);
 if(!ids.length)return {byLab:new Map(),total:0};
 const scope=ctx.client.slug+"|"+ids.join(",");
 let cache=caches.get(pool);
 if(!cache){cache=new Map();caches.set(pool,cache);}
 const current=cache.get(scope);
 if(current?.value&&current.expires>Date.now())return current.value;
 if(current?.pending)return current.pending;
 const pending=(async()=>{
  // Instrumentar únicamente los fallos de caché. Pocos usuarios significa que
  // la primera consulta, no solo los aciertos posteriores, debe ser rápida.
  // No registrar CN, nombres de artículos, farmacia ni datos de ventas.
  const started=Date.now();
  try{
   // Ruta normal: dos consultas pequeñas a la tabla consolidada persistente.
   // Si el snapshot no está instalado aún se conserva la consulta original.
   let rows,source="snapshot";
   try{
    const state=await pool.query({text:`
     SELECT actualizado_en FROM farmetrica.preparador_ultima_recepcion_estado
     WHERE cliente_slug=$1`,values:[ctx.client.slug],query_timeout:3000});
    if(state.rows.length){
     const response=await pool.query({text:`
      SELECT lab_id::text AS lab_id,cn,nombre
      FROM farmetrica.preparador_ultima_recepcion_cache
      WHERE cliente_slug=$1 AND pharmacy_ids && $2::int[]
       AND NOT (blocked_pharmacy_ids && $2::int[])
      ORDER BY lab_id,cn`,values:[ctx.client.slug,ids],query_timeout:6000});
     rows=response.rows;
     if(Date.now()-new Date(state.rows[0].actualizado_en).getTime()>STALE_MS)
      void refreshLastReceiptSnapshot(pool,ctx).catch(()=>{});
    }
   }catch(error){
    if(error.code!=="42P01")
     console.warn("PREPARADOR_SNAPSHOT_READ",error.code||error.name);
   }
   if(!rows){
    source="historic";
    const patterns=await readRetirementPatterns(pool,ctx.client.slug);
    const sql=SQL.replaceAll("__SCHEMA__",'"'+ctx.client.schema+'"')
     .replaceAll("__PHARMACY_CODE__",pharmacyDataCodeSQL("f"));
    ({rows}=await pool.query({text:sql,values:[ctx.client.slug,ids,patterns],
     query_timeout:90000}));
   }
   const byLab=new Map();
   for(const r of rows){
    const id=String(r.lab_id),cn=String(r.cn);
    if(!byLab.has(id))byLab.set(id,[]);
    byLab.get(id).push({referencia:cn,cn,nombre:r.nombre||cn,
     tipo:Number(cn.slice(0,6))>=400000?"medicacion":"parafarmacia",
     inMaster:false,inReceipts:true,inPurchases:true,inSales:false,
     generic:false,provisional:false,pharmacyIds:null});
   }
   console.info("PREPARADOR_ULTIMA_RECEPCION",JSON.stringify({
    status:"ok",source,elapsedMs:Date.now()-started,
    pharmacies:ids.length,references:rows.length
   }));
   return {byLab,total:rows.length};
  }catch(error){
   console.warn("PREPARADOR_ULTIMA_RECEPCION",JSON.stringify({
    status:"error",elapsedMs:Date.now()-started,
    pharmacies:ids.length,code:error.code||error.name||"QUERY_ERROR"
   }));
   throw error;
  }
 })();
 cache.set(scope,{pending});
 try{
  const value=await pending;
  if(cache.get(scope)?.pending===pending){
   cache.set(scope,{value,expires:Date.now()+CACHE_MS});
   if(cache.size>100)cache.delete(cache.keys().next().value);
  }
  return value;
 }catch(e){if(cache.get(scope)?.pending===pending)cache.delete(scope);throw e;}
}
