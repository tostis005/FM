// La estructura de cada origen ERP cambia infrecuentemente. Compartir la
// comprobación entre catálogo y matriz evita repetir information_schema en
// cada consulta de laboratorio sin asumir un esquema universal.
const pools=new WeakMap();
const TTL_MS=5*60*1000;
const IDENT=/^[a-z][a-z0-9_]{1,62}$/;

export function hasNativeNormalizedCN(pool,schema){
 if(!IDENT.test(schema))return Promise.reject(Error("Esquema no autorizado"));
 let cache=pools.get(pool);
 if(!cache){cache=new Map();pools.set(pool,cache)}
 const current=cache.get(schema);
 if(current?.pending)return current.pending;
 if(current&&current.expires>Date.now())return Promise.resolve(current.value);
 const pending=pool.query({text:`SELECT EXISTS (
  SELECT 1 FROM information_schema.columns
  WHERE table_schema=$1 AND table_name='articulos'
   AND column_name='cn_normalizado') AS available`,
  values:[schema],query_timeout:1500}).then(({rows})=>{
   if(typeof rows?.[0]?.available!=="boolean")throw Error("Metadatos de artículos incompletos");
   const value=rows[0].available;
   if(cache.get(schema)?.pending===pending)
    cache.set(schema,{value,expires:Date.now()+TTL_MS});
   return value;
  }).catch(error=>{
   if(cache.get(schema)?.pending===pending)cache.delete(schema);
   throw error;
  });
 cache.set(schema,{pending});
 return pending;
}

// Comprobar la disponibilidad REAL del índice antes de forzar búsquedas
// LATERAL por cada CN. Si otro tenant no lo tiene, conservar el plan normal.
// Esta comprobación se comparte entre peticiones y solo lee catálogos de PG.
const indexedPools=new WeakMap();
export function hasIndexedNormalizedCN(pool,schema){
 if(!IDENT.test(schema))return Promise.reject(Error("Esquema no autorizado"));
 let cache=indexedPools.get(pool);
 if(!cache){cache=new Map();indexedPools.set(pool,cache)}
 const current=cache.get(schema);
 if(current?.pending)return current.pending;
 if(current&&current.expires>Date.now())return Promise.resolve(current.value);
 const pending=pool.query({text:`SELECT EXISTS (
  SELECT 1 FROM pg_index i
  JOIN pg_class idx ON idx.oid=i.indexrelid
  JOIN pg_class tab ON tab.oid=i.indrelid
  JOIN pg_namespace ns ON ns.oid=tab.relnamespace
  WHERE ns.nspname=$1 AND tab.relname='articulos'
   AND idx.relname IN ('fm_preparador_articulo_normalizado_idx',
    'articulos_farmacia_cn_norm_preparador_idx')
   AND i.indisvalid AND i.indisready
 ) AS available`,
 values:[schema],query_timeout:1500}).then(({rows})=>{
  if(typeof rows?.[0]?.available!=="boolean")throw Error("Metadatos de índice incompletos");
  const value=rows[0].available;
  if(cache.get(schema)?.pending===pending)
   cache.set(schema,{value,expires:Date.now()+TTL_MS});
  return value;
 }).catch(error=>{
  if(cache.get(schema)?.pending===pending)cache.delete(schema);
  throw error;
 });
 cache.set(schema,{pending});
 return pending;
}
