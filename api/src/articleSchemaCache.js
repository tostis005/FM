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
