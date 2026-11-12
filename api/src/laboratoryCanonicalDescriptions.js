import {hasNativeNormalizedCN} from "./articleSchemaCache.js";
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
import {isRetiredProductName} from "./laboratoryRetirements.js";

const SCHEMA=/^[a-z][a-z0-9_]{1,62}$/;
const CN=/^[0-9]{6,7}$/;

/**
 * El preparador muestra UNA descripción por CN:
 * - medicación: ficha Farmatic de Abadía (código ABA);
 * - parafarmacia: ficha del almacén central (ALMACEN; AMP histórico).
 * Si el establecimiento no dispone de ese CN, conservar la descripción
 * existente del catálogo. No escribir jamás sobre el ERP ni sobre pedidos.
 *
 * Exclusiones: recalcular SIEMPRE sobre ese mismo nombre visible y únicamente
 * las cadenas que haya guardado el cliente. No heredar el booleano de otra
 * farmacia, la caché de última recepción o un nombre alternativo.
 */
export function applyCanonicalDescriptions(rows,names,patterns=[]){
 return rows.map(row=>{
  const cn=String(row.cn||"");
  const canonical=names.get(cn);
  const nombre=typeof canonical==="string"&&canonical.trim()?canonical.trim():row.nombre;
  return {...row,nombre,excluded:isRetiredProductName(nombre,patterns)};
 });
}

export async function canonicalizeLaboratoryCatalog(pool,ctx,catalog,type,patterns=[]){
 if(!catalog||!Array.isArray(catalog.rows)||!catalog.rows.length)return catalog;
 if(!SCHEMA.test(ctx.client.schema)||!["medicacion","parafarmacia"].includes(type))
  throw Error("Esquema o tipo no válido");
 const codes=[...new Set(catalog.rows.map(row=>String(row.cn||"")).filter(cn=>CN.test(cn)))];
 const names=new Map();
 if(codes.length){
  try{
   const hasNativeCN=await hasNativeNormalizedCN(pool,ctx.client.schema).catch(()=>false);
   const schema='"'+ctx.client.schema+'"';
   const cnNormalized=hasNativeCN?`
 UNION ALL
 SELECT nullif(btrim(a.cn_normalizado),''),btrim(a.nombre),p.priority,1 AS match_priority
 FROM canonical_pharmacy p JOIN ${schema}.articulos a
  ON upper(btrim(a.farmacia_codigo))=p.code
 WHERE nullif(btrim(a.cn_normalizado),'')=ANY($2::text[])
   AND nullif(btrim(a.cn_normalizado),'') IS NOT NULL`:"";
   const sql=`
WITH canonical_pharmacy AS MATERIALIZED (
 SELECT ${pharmacyDataCodeSQL("f")} AS code,0 AS priority
 FROM farmetrica.farmacias f
 WHERE f.cliente_slug=$1 AND (
  ($3::text='medicacion' AND upper(btrim(f.codigo_origen))='ABA')
  OR ($3::text='parafarmacia' AND f.tipo_establecimiento='almacen')
 )
 UNION ALL
 -- La antigua clave AMP del mismo almacén puede conservar fichas sin
 -- entrada ALMACEN. Nunca sobreescribe una descripción actual.
 SELECT 'AMP'::text AS code,1 AS priority
 FROM farmetrica.farmacias f
 WHERE $1='ampedia' AND $3::text='parafarmacia'
  AND f.cliente_slug=$1 AND f.tipo_establecimiento='almacen'
  AND upper(btrim(f.codigo_origen))='ALMACEN'
), matched AS (
 SELECT btrim(a.codigo_nacional) AS cn,btrim(a.nombre) AS nombre,
  p.priority,0 AS match_priority
 FROM canonical_pharmacy p JOIN ${schema}.articulos a
  ON upper(btrim(a.farmacia_codigo))=p.code
 WHERE btrim(a.codigo_nacional)=ANY($2::text[])
   AND nullif(btrim(a.codigo_nacional),'') IS NOT NULL
 ${cnNormalized}
 UNION ALL
 SELECT a.origen_id::text AS cn,btrim(a.nombre) AS nombre,
  p.priority,2 AS match_priority
 FROM canonical_pharmacy p JOIN ${schema}.articulos a
  ON upper(btrim(a.farmacia_codigo))=p.code
 WHERE a.origen_id::text=ANY($2::text[])
)
SELECT DISTINCT ON (cn) cn,nombre FROM matched
WHERE nullif(nombre,'') IS NOT NULL
ORDER BY cn,priority,match_priority,nombre`;
   const response=await pool.query({text:sql,
    values:[ctx.client.slug,codes,type],query_timeout:6500});
   for(const row of response.rows||[])if(CN.test(String(row.cn||""))&&row.nombre)
    names.set(String(row.cn),String(row.nombre));
  }catch(error){
   // No truncar el catálogo ni conservar bajas ocultas si falla la
   // lectura del nombre canónico. Se evalúa la descripción visible actual.
   console.warn("PREPARADOR_NOMBRE_CANONICO",JSON.stringify({
    status:"fallback",code:error.code||error.name||"QUERY_ERROR"
   }));
  }
 }
 return {...catalog,rows:applyCanonicalDescriptions(catalog.rows,names,patterns)};
}
