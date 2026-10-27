// Modo reversible del preparador: sólo el laboratorio de la última
// recepción positiva válida de cada CN. No modifica datos de Farmatic.
import {readFile} from "node:fs/promises";
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
  const sql=SQL.replaceAll("__SCHEMA__",'"'+ctx.client.schema+'"');
  const {rows}=await pool.query({text:sql,values:[ctx.client.slug,ids],query_timeout:90000});
  const byLab=new Map();
  for(const r of rows){
   const id=String(r.lab_id),cn=String(r.cn);
   if(!byLab.has(id))byLab.set(id,[]);
   byLab.get(id).push({referencia:cn,cn,nombre:r.nombre||cn,
    tipo:Number(cn.slice(0,6))>=400000?"medicacion":"parafarmacia",
    inMaster:false,inReceipts:true,inPurchases:true,inSales:false,
    generic:false,provisional:false,pharmacyIds:null});
  }
  return {byLab,total:rows.length};
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
