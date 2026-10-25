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
  // Una edición del maestro puede invalidar la caché mientras la consulta
  // todavía está en curso: nunca memorizar ese resultado anterior.
  if(cache.get(key)?.pending===pending){
   cache.set(key,{rows,expires:Date.now()+TTL});
   if(cache.size>150)cache.delete(cache.keys().next().value);
  }
  return rows;
 }).catch(error=>{
  if(cache.get(key)?.pending===pending)cache.delete(key);
  throw error;
 });
}

/** La edición del maestro debe reflejarse inmediatamente en el preparador,
 * sin esperar a los dos minutos de caducidad de la caché. */
export function invalidateCachedLaboratoryOptions(pool,tenant){
 const cache=pools.get(pool);
 if(!cache)return;
 for(const key of cache.keys())if(key.startsWith(tenant+"|"))cache.delete(key);
}
