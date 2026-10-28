// Modo reversible del preparador: sólo el laboratorio de la última
// recepción positiva válida de cada CN. No modifica datos de Farmatic.
import {readFile} from "node:fs/promises";
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
import {readRetirementPatterns} from "./laboratoryRetirements.js";
const SQL=await readFile(new URL("./preparadorLastReceipt.sql",import.meta.url),"utf8");
const CACHE_MS=120_000;
const caches=new WeakMap();
export const lastReceiptMode=()=>process.env.FM_PREPARADOR_ULTIMA_RECEPCION!=="0";
export function invalidateLastReceiptCache(pool,slug){
 const cache=caches.get(pool);
 if(!cache)return;
 for(const key of cache.keys())if(key.startsWith(slug+"|"))cache.delete(key);
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
   const patterns=await readRetirementPatterns(pool,ctx.client.slug);
   const sql=SQL.replaceAll("__SCHEMA__",'"'+ctx.client.schema+'"')
    .replaceAll("__PHARMACY_CODE__",pharmacyDataCodeSQL("f"));
   const {rows}=await pool.query({text:sql,values:[ctx.client.slug,ids,patterns],query_timeout:90000});
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
    status:"ok",elapsedMs:Date.now()-started,
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
