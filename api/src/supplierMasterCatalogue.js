import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
import {retiredProductSQL} from "./laboratoryRetirements.js";
import {hasNativeNormalizedCN} from "./articleSchemaCache.js";
const SCHEMA=/^[a-z][a-z0-9_]{1,62}$/;
const normalizeCode=expr=>`CASE WHEN btrim(coalesce(${expr}::text,'')) ~ '^[0-9]+$'
 THEN coalesce(nullif(ltrim(btrim(${expr}::text),'0'),''),'0')
 ELSE upper(btrim(coalesce(${expr}::text,''))) END`;

const supplierColumns=["proveedor_habitual_id","proveedor_id","proveedor_codigo","proveedor"];
const supplierFields=new WeakMap();
export async function readArticleSupplierField(pool,schema){
 if(!SCHEMA.test(schema))throw Error("Esquema inválido");
 let cache=supplierFields.get(pool);
 if(!cache){cache=new Map();supplierFields.set(pool,cache)}
 const current=cache.get(schema);
 if(current?.pending)return current.pending;
 if(current&&current.expires>Date.now())return current.value;
 const pending=pool.query({text:`SELECT column_name
  FROM information_schema.columns
  WHERE table_schema=$1 AND table_name='articulos'
   AND column_name=ANY($2::text[])`,
  values:[schema,supplierColumns],query_timeout:2000}).then(({rows})=>{
   const present=new Set(rows.map(r=>r.column_name));
   const value=supplierColumns.find(column=>present.has(column))||null;
   if(cache.get(schema)?.pending===pending)
    cache.set(schema,{value,expires:Date.now()+300000});
   return value;
  }).catch(error=>{
   if(cache.get(schema)?.pending===pending)cache.delete(schema);
   throw error;
  });
 cache.set(schema,{pending});
 return pending;
}

/** Maestro ERP completo por proveedor habitual de la misma farmacia.
 * Este origen complementa las recepciones y no requiere ventas previas.
 * No extrapolar IDs ERP de una farmacia a otra. */
export async function readSupplierMasterCatalogue(pool,ctx,{id,pharmacies,type,search="",patterns=[]}){
 if(!SCHEMA.test(ctx.client.schema)||!(/^[1-9][0-9]{0,17}$/.test(String(id))))
  throw Error("Proveedor inválido");
 // Resolver en paralelo el esquema del proveedor y la columna de CN.
 // Evita serializar comprobaciones de information_schema en la carga fría.
 const [field,nativeCN]=await Promise.all([
  readArticleSupplierField(pool,ctx.client.schema),
  hasNativeNormalizedCN(pool,ctx.client.schema).catch(()=>false)
 ]);
 // El catálogo de últimas recepciones cubre orígenes sin proveedor habitual.
 if(!field)return [];
 const q='"'+ctx.client.schema+'"';
 // La columna nativa, cuando existe, evita convertir a JSON cada ficha ERP.
 // En esquemas antiguos se conserva exactamente el fallback anterior.
 const cnNormalizado=nativeCN?"a.cn_normalizado":"to_jsonb(a)->>'cn_normalizado'";
 const sql=`
 WITH chosen AS (
  SELECT f.id,${pharmacyDataCodeSQL("f")} AS code
  FROM farmetrica.farmacias f
  WHERE f.cliente_slug=$1 AND f.id=ANY($2::int[])
  UNION ALL
  -- AMP: código histórico del almacén central ALMACEN para recepciones y ERP.
  SELECT f.id,'AMP'::text AS code
  FROM farmetrica.farmacias f
  WHERE f.cliente_slug=$1 AND f.cliente_slug='ampedia' AND f.activo
   AND f.tipo_establecimiento='almacen'
   AND upper(btrim(f.codigo_origen))='ALMACEN'
   AND cardinality($2::int[])>0
 ), aliases AS (
  -- Identidad: código proveedor de Farmatic + farmacia, no nombre comercial.
  SELECT DISTINCT c.id AS pharmacy_id,c.code,${normalizeCode("ua.codigo_origen")} AS supplier
  FROM farmetrica.proveedores_unificados_alias ua
  JOIN chosen c ON c.code=upper(btrim(ua.farmacia_codigo))
  JOIN farmetrica.proveedores_unificados p
   ON p.cliente_slug=ua.cliente_slug AND p.id=ua.proveedor_id
  WHERE ua.cliente_slug=$1 AND ua.proveedor_id=$3
   AND p.activo AND p.clase IN ('DIRECTO','VACUNAS','FÓRMULAS')
 ), matched AS MATERIALIZED (
  SELECT DISTINCT c.pharmacy_id,a.origen_id::text AS article_id,
   coalesce(
    CASE WHEN btrim(coalesce(a.codigo_nacional,'')) ~ '^[0-9]{6,7}$'
     THEN btrim(a.codigo_nacional) END,
    CASE WHEN btrim(coalesce(${cnNormalizado},'')) ~ '^[0-9]{6,7}$'
     THEN btrim(${cnNormalizado}) END,
    CASE WHEN btrim(a.origen_id::text) ~ '^[0-9]{6,7}$'
     THEN btrim(a.origen_id::text) END
   ) AS cn,
   coalesce(nullif(btrim(a.nombre),''),a.origen_id::text) AS nombre,
   ${retiredProductSQL("a.nombre","$6")} AS inactive
  FROM aliases c JOIN ${q}.articulos a
   ON upper(btrim(a.farmacia_codigo))=c.code
   AND ${normalizeCode("a."+field)}=c.supplier
  WHERE nullif(btrim(a.origen_id::text),'') IS NOT NULL
 )
 SELECT coalesce(cn,'ERP:'||pharmacy_id::text||':'||article_id) AS referencia,
  cn,min(nombre) AS nombre,$4::text AS tipo,
  false AS "inMaster",false AS "inReceipts",false AS "inPurchases",
  false AS "inSales",false AS generic,(cn IS NULL) AS provisional,
  bool_or(inactive) AS excluded,
  string_agg(DISTINCT pharmacy_id::text,',' ORDER BY pharmacy_id::text) AS "pharmacyIds"
 FROM matched
 WHERE (cn IS NOT NULL OR article_id ~ '^[A-Za-z0-9._:-]{1,90}$')
  -- La última recepción directa válida prevalece sobre la ficha habitual.
  AND NOT EXISTS (
   SELECT 1 FROM farmetrica.preparador_ultima_recepcion_cache winner
   WHERE winner.cliente_slug=$1 AND winner.cn=matched.cn
    AND winner.lab_id<>$3::bigint
  )
  AND (CASE WHEN cn IS NOT NULL AND left(cn,6)::integer>=400000
   THEN 'medicacion' ELSE 'parafarmacia' END)=$4
  AND (coalesce($5::text,'')='' OR cn ILIKE '%'||$5||'%'
   OR nombre ILIKE '%'||$5||'%')
 GROUP BY coalesce(cn,'ERP:'||pharmacy_id::text||':'||article_id),cn
 ORDER BY min(nombre),referencia LIMIT 5001`;
 const {rows}=await pool.query({text:sql,
  values:[ctx.client.slug,pharmacies,id,type,search,patterns],query_timeout:15000});
 if(rows.length>5000)throw Object.assign(Error("Más de 5000 referencias de catálogo"),{code:"TOO_MANY"});
 // No atribuir productos a partir de regalos, variantes ni otros artículos.
 return rows;
}
/** Fusionar por CN sin mezclar referencias ni perder la evidencia de compra. */
export function mergeSupplierCatalogReferences(purchased,master,search="",type="parafarmacia"){
 const joined=new Map(),term=String(search||"").trim().toLocaleLowerCase("es");
 for(const row of [...master,...purchased]){
  if(!row?.referencia||row.tipo!==type)continue;
  const key=String(row.referencia),previous=joined.get(key);
  if(previous)joined.set(key,{
   ...previous,...row,excluded:Boolean(previous.excluded||row.excluded),
   inPurchases:Boolean(previous.inPurchases||row.inPurchases),
   inReceipts:Boolean(previous.inReceipts||row.inReceipts),
   inSales:Boolean(previous.inSales||row.inSales),
   pharmacyIds:[...new Set([previous.pharmacyIds,row.pharmacyIds]
    .filter(Boolean).flatMap(v=>String(v).split(",")))].sort().join(",")||null
  });
  else joined.set(key,{...row});
 }
 const rows=[...joined.values()].filter(row=>!term||
  String(row.nombre||"").toLocaleLowerCase("es").includes(term)||
  String(row.referencia).includes(term))
  .sort((a,b)=>String(a.nombre||"").localeCompare(String(b.nombre||""),"es")||
   String(a.referencia).localeCompare(String(b.referencia)));
 if(rows.length>5000)throw Object.assign(Error("Demasiadas referencias de catálogo"),{code:"TOO_MANY"});
 return {rows,total:rows.length,metricsUnavailable:true};
}

     THEN btrim(${cnNormalizado}) END,
    CASE WHEN btrim(a.origen_id::text) ~ '^[0-9]{6,7}$'
     THEN btrim(a.origen_id::text) END
   ) AS cn,
   coalesce(nullif(btrim(a.nombre),''),a.origen_id::text) AS nombre,
   ${retiredProductSQL("a.nombre","$6")} AS inactive
  FROM aliases c JOIN ${q}.articulos a
   ON upper(btrim(a.farmacia_codigo))=c.code
   AND ${normalizeCode("a."+field)}=c.supplier
  WHERE nullif(btrim(a.origen_id::text),'') IS NOT NULL
 )
 SELECT coalesce(cn,'ERP:'||pharmacy_id::text||':'||article_id) AS referencia,
  cn,min(nombre) AS nombre,$4::text AS tipo,
  false AS "inMaster",false AS "inReceipts",false AS "inPurchases",
  false AS "inSales",false AS generic,(cn IS NULL) AS provisional,
  bool_or(inactive) AS excluded,
  string_agg(DISTINCT pharmacy_id::text,',' ORDER BY pharmacy_id::text) AS "pharmacyIds"
 FROM matched
 WHERE (cn IS NOT NULL OR article_id ~ '^[A-Za-z0-9._:-]{1,90}$')
  -- La última recepción directa válida prevalece sobre la ficha habitual.
  AND NOT EXISTS (
   SELECT 1 FROM farmetrica.preparador_ultima_recepcion_cache winner
   WHERE winner.cliente_slug=$1 AND winner.cn=matched.cn
    AND winner.lab_id<>$3::bigint
  )
  AND (CASE WHEN cn IS NOT NULL AND left(cn,6)::integer>=400000
   THEN 'medicacion' ELSE 'parafarmacia' END)=$4
  AND (coalesce($5::text,'')='' OR cn ILIKE '%'||$5||'%'
   OR nombre ILIKE '%'||$5||'%')
 GROUP BY coalesce(cn,'ERP:'||pharmacy_id::text||':'||article_id),cn
 ORDER BY min(nombre),referencia LIMIT 5001`;
 const {rows}=await pool.query({text:sql,
  values:[ctx.client.slug,pharmacies,id,type,search,patterns],query_timeout:15000});
 if(rows.length>5000)throw Object.assign(Error("Más de 5000 referencias de catálogo"),{code:"TOO_MANY"});
 // No atribuir productos a partir de regalos, variantes ni otros artículos.
 return rows;
}
/** Fusionar por CN sin mezclar referencias ni perder la evidencia de compra. */
export function mergeSupplierCatalogReferences(purchased,master,search="",type="parafarmacia"){
 const joined=new Map(),term=String(search||"").trim().toLocaleLowerCase("es");
 for(const row of [...master,...purchased]){
  if(!row?.referencia||row.tipo!==type)continue;
  const key=String(row.referencia),previous=joined.get(key);
  if(previous)joined.set(key,{
   ...previous,...row,excluded:Boolean(previous.excluded||row.excluded),
   inPurchases:Boolean(previous.inPurchases||row.inPurchases),
   inReceipts:Boolean(previous.inReceipts||row.inReceipts),
   inSales:Boolean(previous.inSales||row.inSales),
   pharmacyIds:[...new Set([previous.pharmacyIds,row.pharmacyIds]
    .filter(Boolean).flatMap(v=>String(v).split(",")))].sort().join(",")||null
  });
  else joined.set(key,{...row});
 }
 const rows=[...joined.values()].filter(row=>!term||
  String(row.nombre||"").toLocaleLowerCase("es").includes(term)||
  String(row.referencia).includes(term))
  .sort((a,b)=>String(a.nombre||"").localeCompare(String(b.nombre||""),"es")||
   String(a.referencia).localeCompare(String(b.referencia)));
 if(rows.length>5000)throw Object.assign(Error("Demasiadas referencias de catálogo"),{code:"TOO_MANY"});
 return {rows,total:rows.length,metricsUnavailable:true};
}
