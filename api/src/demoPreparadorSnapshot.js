// En una demo, el cacheado de última recepción es un dato derivado VIVO del origen.
// Proveedores y farmacias tienen IDs independientes: mapear ambos en lectura.
// No duplicar 23.000 referencias ni reconstruir albaranes de Amperia por demo.
import {resolveDemoSourceScope} from "./demoDataScope.js";

async function sourceScope(pool,ctx,pharmacies){
 if(!ctx?.client?.demo)return null;
 return resolveDemoSourceScope(pool,ctx,pharmacies);
}
async function sourceReady(pool,slug){
 const {rows}=await pool.query({text:
  "SELECT 1 FROM farmetrica.preparador_ultima_recepcion_estado WHERE cliente_slug=$1",
  values:[slug],query_timeout:3000});
 return rows.length>0;
}
const supplierJoin=\`
 JOIN farmetrica.proveedores_unificados origen
  ON origen.cliente_slug=$1 AND origen.id=cache.lab_id
 JOIN farmetrica.proveedores_unificados demo
  ON demo.cliente_slug=$2 AND demo.clave_unificada=origen.clave_unificada\`;

export async function demoLaboratoryIdsFromSnapshot(pool,ctx,pharmacies){
 const scope=await sourceScope(pool,ctx,pharmacies);
 if(!scope)return null;
 if(!await sourceReady(pool,scope.slug))return null;
 const {rows}=await pool.query({text:\`
  SELECT DISTINCT demo.id::text AS lab_id
  FROM farmetrica.preparador_ultima_recepcion_cache cache
  \${supplierJoin}
  WHERE cache.cliente_slug=$1 AND cache.pharmacy_ids && $3::int[]
  ORDER BY lab_id\`,
  values:[scope.slug,ctx.client.slug,scope.ids],query_timeout:6000});
 return rows.map(r=>String(r.lab_id));
}

export async function demoSupplierCNFromSnapshot(pool,ctx,pharmacies,labId){
 const scope=await sourceScope(pool,ctx,pharmacies);
 if(!scope)return null;
 if(!await sourceReady(pool,scope.slug))return null;
 const {rows}=await pool.query({text:\`
  SELECT cache.cn,cache.nombre,
   (cache.blocked_pharmacy_ids && $4::int[]) AS excluded
  FROM farmetrica.preparador_ultima_recepcion_cache cache
  \${supplierJoin}
  WHERE cache.cliente_slug=$1 AND demo.id=$3::bigint
   AND cache.pharmacy_ids && $4::int[]
  ORDER BY cache.cn\`,
  values:[scope.slug,ctx.client.slug,labId,scope.ids],query_timeout:6000});
 return rows;
}

export async function demoAllLaboratoryCNFromSnapshot(pool,ctx,pharmacies){
 const scope=await sourceScope(pool,ctx,pharmacies);
 if(!scope)return null;
 if(!await sourceReady(pool,scope.slug))return null;
 const {rows}=await pool.query({text:\`
  SELECT demo.id::text AS lab_id,cache.cn,cache.nombre,
   (cache.blocked_pharmacy_ids && $3::int[]) AS excluded
  FROM farmetrica.preparador_ultima_recepcion_cache cache
  \${supplierJoin}
  WHERE cache.cliente_slug=$1 AND cache.pharmacy_ids && $3::int[]
  ORDER BY lab_id,cache.cn\`,
  values:[scope.slug,ctx.client.slug,scope.ids],query_timeout:6500});
 return rows;
}
