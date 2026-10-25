// Caché de lectura por instancia de conexión y ámbito autorizado.
// Evita reconstruir el selector en cada visita, sin mezclar clientes o farmacias.
// El máximo tiempo con datos almacenados es de 2 minutos.
const TTL=120_000;
const pools=new WeakMap();
export function readCachedLaboratoryOptions(pool,tenant,pharmacies,loader){
 let cache=pools.get(pool);
 if(!cache){cache=new Map();pools.set(pool,cache)}
 const scope=[...new Set(pharmacies.map(Number))].sort((a,b)=>a-b).join(",");
 const key=tenant+"|"+scope,now=Date.now();
 const existing=cache.get(key);
 if(existing?.rows&&existing.expires>now)return Promise.resolve(existing.rows);
 if(existing?.pending)return existing.pending;
 const pending=Promise.resolve().then(loader);
 cache.set(key,{pending,expires:0});
 return pending.then(rows=>{
  if(!Array.isArray(rows))throw Error("Catálogo de laboratorios inválido");
  cache.set(key,{rows,expires:Date.now()+TTL});
  if(cache.size>150)cache.delete(cache.keys().next().value);
  return rows;
 }).catch(error=>{
  cache.delete(key);
  throw error;
 });
}
