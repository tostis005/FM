import {normalizedLabSQL} from "./laboratoryIdentity.js";
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
import {readRetirementPatterns,retiredProductSQL} from "./laboratoryRetirements.js";

const SCHEMA=/^[a-z][a-z0-9_]{1,62}$/;
const validCN=expr=>`CASE WHEN btrim(coalesce(${expr}::text,'')) ~ '^[0-9]{6,7}$'
 THEN btrim(${expr}::text) ELSE NULL::text END`;
const supplierCode=expr=>`CASE WHEN btrim(${expr}::text) ~ '^[0-9]+$'
 THEN coalesce(nullif(ltrim(btrim(${expr}::text),'0'),''),'0')
 ELSE upper(btrim(${expr}::text)) END`;
const officialMatch=alias=>`('N:'||${normalizedLabSQL(alias+".laboratorio_comercializador")}=$1
 OR 'N:'||${normalizedLabSQL(alias+".laboratorio_titular")}=$1
 OR 'N:'||${normalizedLabSQL(alias+".laboratorio")}=$1
 OR ('C:'||upper(btrim(coalesce(${alias}.laboratorio_comercializador_codigo,'')))=$1)
 OR ('C:'||upper(btrim(coalesce(${alias}.laboratorio_titular_codigo,'')))=$1)
 OR ('C:'||upper(btrim(coalesce(${alias}.laboratorio_codigo,'')))=$1))`;

/**
 * ÚNICO universo: presentaciones del Nomenclátor + artículos que figuran en
 * alguna venta o recepción de una farmacia seleccionada.
 * Farmatic se usa para interpretar identificador, nombre, laboratorio y stock,
 * NUNCA para aportar artículos que no tengan movimientos.
 * Tampoco se incorpora el catálogo externo/Vademécum.
 */
export async function readDirectLaboratoryCatalog(pool,context,{key,pharmacies,type,search="",page=1,size=40}){
 if(!SCHEMA.test(context.client.schema))throw Error("Esquema no autorizado");
 const schema='"'+context.client.schema+'"';
 const patterns=await readRetirementPatterns(pool,context.client.slug);
 let hasNativeCN=false;
 try{
  const {rows}=await pool.query({text:`SELECT EXISTS(
   SELECT 1 FROM information_schema.columns WHERE table_schema=$1
   AND table_name='articulos' AND column_name='cn_normalizado') AS available`,
   values:[context.client.schema],query_timeout:1500});
  hasNativeCN=rows[0]?.available===true;
 }catch{}
 const cn= `coalesce(${validCN("a.codigo_nacional")},
   ${validCN(hasNativeCN?"a.cn_normalizado":"to_jsonb(a)->>'cn_normalizado'")},
   CASE WHEN EXISTS(SELECT 1 FROM farmetrica.nomenclator_presentaciones verified
    WHERE verified.cn=btrim(coalesce(a.origen_id::text,m.article_id)))
    THEN ${validCN("coalesce(a.origen_id::text,m.article_id)")} ELSE NULL::text END)`;
 const blockedCN=`coalesce(${validCN("a.codigo_nacional")},
   ${validCN(hasNativeCN?"a.cn_normalizado":"to_jsonb(a)->>'cn_normalizado'")},
   ${validCN("a.origen_id::text")})`;
 const sql=`
 WITH pharmacies AS (
  SELECT f.id,${pharmacyDataCodeSQL("f")} AS code
  FROM farmetrica.farmacias f WHERE f.cliente_slug=$3 AND f.id=ANY($2::int[])
 ), lab_aliases AS MATERIALIZED (
  -- El selector usa N:nombre, pero una relación ERP puede usar C:código AEMPS.
  -- Unificar ambas identidades sin confundir laboratorios diferentes.
  SELECT $1::text AS key
  UNION SELECT 'N:'||${normalizedLabSQL("n.laboratorio_titular")}
   FROM farmetrica.nomenclator_presentaciones n WHERE ${officialMatch("n")}
  UNION SELECT 'N:'||${normalizedLabSQL("n.laboratorio_comercializador")}
   FROM farmetrica.nomenclator_presentaciones n WHERE ${officialMatch("n")}
  UNION SELECT 'N:'||${normalizedLabSQL("n.laboratorio")}
   FROM farmetrica.nomenclator_presentaciones n WHERE ${officialMatch("n")}
  UNION SELECT 'C:'||upper(btrim(n.laboratorio_titular_codigo))
   FROM farmetrica.nomenclator_presentaciones n WHERE ${officialMatch("n")}
    AND nullif(btrim(n.laboratorio_titular_codigo),'') IS NOT NULL
  UNION SELECT 'C:'||upper(btrim(n.laboratorio_comercializador_codigo))
   FROM farmetrica.nomenclator_presentaciones n WHERE ${officialMatch("n")}
    AND nullif(btrim(n.laboratorio_comercializador_codigo),'') IS NOT NULL
  UNION SELECT 'C:'||upper(btrim(n.laboratorio_codigo))
   FROM farmetrica.nomenclator_presentaciones n WHERE ${officialMatch("n")}
    AND nullif(btrim(n.laboratorio_codigo),'') IS NOT NULL
 ), supplier_links AS (
  SELECT m.farmacia_id,${supplierCode("m.codigo_proveedor")} AS supplier_code,
   m.laboratorio_clave AS laboratory_key
  FROM farmetrica.proveedores_laboratorios m
  JOIN pharmacies p ON p.id=m.farmacia_id
  WHERE m.cliente_slug=$3 AND NOT EXISTS (
   SELECT 1 FROM farmetrica.proveedores_maestro pm
   WHERE pm.cliente_slug=$3 AND pm.cooperativa=true
    AND ${supplierCode("pm.codigo_origen")}=${supplierCode("m.codigo_proveedor")}
    AND EXISTS (SELECT 1 FROM ${schema}.proveedores sp
     WHERE upper(btrim(sp.farmacia_codigo))=p.code
      AND ${supplierCode("sp.origen_id")}=${supplierCode("m.codigo_proveedor")}
      AND ${normalizedLabSQL("sp.nombre")}=${normalizedLabSQL("pm.nombre")}))
  UNION ALL
  SELECT p.id,${supplierCode("pm.codigo_origen")},pm.laboratorio_clave
  FROM farmetrica.proveedores_maestro pm CROSS JOIN pharmacies p
  WHERE pm.cliente_slug=$3 AND pm.laboratorio_clave IS NOT NULL
   AND pm.cooperativa IS NOT TRUE
   -- Nunca extrapolar un código global de Farmatic a otra farmacia con otro proveedor.
   AND EXISTS (SELECT 1 FROM ${schema}.proveedores sp
    WHERE upper(btrim(sp.farmacia_codigo))=p.code
     AND ${supplierCode("sp.origen_id")}=${supplierCode("pm.codigo_origen")}
     AND ${normalizedLabSQL("sp.nombre")}=${normalizedLabSQL("pm.nombre")})
   AND NOT EXISTS (
    SELECT 1 FROM farmetrica.proveedores_laboratorios m
    WHERE m.cliente_slug=$3 AND m.farmacia_id=p.id
     AND ${supplierCode("m.codigo_proveedor")}=${supplierCode("pm.codigo_origen")})
  UNION ALL
  -- El proveedor de Farmatic ya puede llamarse CINFA sin asignación manual:
  -- aplicar solo coincidencia EXACTA con el laboratorio normalizado.
  SELECT p.id,${supplierCode("sp.origen_id")},
   'N:'||${normalizedLabSQL("sp.nombre")}
  FROM pharmacies p JOIN ${schema}.proveedores sp
   ON upper(btrim(sp.farmacia_codigo))=p.code
  WHERE 'N:'||${normalizedLabSQL("sp.nombre")}
    IN (SELECT key FROM lab_aliases WHERE key LIKE 'N:%')
   AND NOT EXISTS (
    SELECT 1 FROM farmetrica.proveedores_laboratorios m
    WHERE m.cliente_slug=$3 AND m.farmacia_id=p.id
     AND ${supplierCode("m.codigo_proveedor")}=${supplierCode("sp.origen_id")})
   AND NOT EXISTS (
    SELECT 1 FROM farmetrica.proveedores_maestro pm
    WHERE pm.cliente_slug=$3
     AND ${supplierCode("pm.codigo_origen")}=${supplierCode("sp.origen_id")}
     AND ${normalizedLabSQL("pm.nombre")}=${normalizedLabSQL("sp.nombre")}
     AND (pm.cooperativa IS TRUE OR pm.laboratorio_clave IS NOT NULL))
 ), relevant_articles AS MATERIALIZED (
  -- Primero identifica artículos del laboratorio. No recorre el histórico entero.
  SELECT p.id AS pharmacy_id,p.code,a.origen_id::text AS article_id
  FROM pharmacies p JOIN ${schema}.articulos a
   ON upper(btrim(a.farmacia_codigo))=p.code
  LEFT JOIN farmetrica.nomenclator_presentaciones n
   ON n.cn=coalesce(${validCN("a.codigo_nacional")},
    ${validCN(hasNativeCN?"a.cn_normalizado":"to_jsonb(a)->>'cn_normalizado'")},
    ${validCN("a.origen_id::text")})
  WHERE nullif(btrim(a.origen_id::text),'') IS NOT NULL
   AND ('N:'||${normalizedLabSQL("a.laboratorio")}=$1 OR ${officialMatch("n")})
 ), relevant_receipts AS MATERIALIZED (
  -- Un proveedor vinculado recupera su histórico de recepciones aunque el
  -- laboratorio no estuviera cumplimentado en la ficha de Farmatic.
  SELECT DISTINCT p.id AS pharmacy_id,p.code,r.articulo_id::text AS article_id
  FROM pharmacies p JOIN ${schema}.fm_recepciones_analitica r
   ON r.farmacia_codigo=p.code
  JOIN supplier_links link ON link.farmacia_id=p.id
   AND link.supplier_code=${supplierCode("r.proveedor_id")}
  WHERE r.articulo_id IS NOT NULL
   AND (link.laboratory_key IN (SELECT key FROM lab_aliases)
    OR (link.laboratory_key LIKE 'N:%'
     AND 'N:'||${normalizedLabSQL("substring(link.laboratory_key from 3)")}
       IN (SELECT key FROM lab_aliases)))
  UNION
  -- Si la ficha de proveedores no se sincronizó, usar el nombre REAL del
  -- proveedor en el albarán, siempre que no exista una asignación distinta.
  SELECT DISTINCT p.id,p.code,r.articulo_id::text
  FROM pharmacies p JOIN ${schema}.fm_recepciones_analitica r
   ON r.farmacia_codigo=p.code
  WHERE r.articulo_id IS NOT NULL
   AND 'N:'||${normalizedLabSQL("r.proveedor_nombre")}
       IN (SELECT key FROM lab_aliases WHERE key LIKE 'N:%')
   AND NOT EXISTS (SELECT 1 FROM supplier_links link
    WHERE link.farmacia_id=p.id
     AND link.supplier_code=${supplierCode("r.proveedor_id")})
   AND NOT EXISTS (SELECT 1 FROM farmetrica.proveedores_maestro pm
    WHERE pm.cliente_slug=$3 AND pm.cooperativa IS TRUE
     AND ${supplierCode("pm.codigo_origen")}=${supplierCode("r.proveedor_id")}
     AND ${normalizedLabSQL("pm.nombre")}=${normalizedLabSQL("r.proveedor_nombre")})
 ), candidates AS MATERIALIZED (
  SELECT pharmacy_id,code,article_id FROM relevant_articles
  UNION SELECT pharmacy_id,code,article_id FROM relevant_receipts
  UNION
  -- Artículo sin ficha ERP, pero vendido o recibido con CN oficial.
  SELECT p.id,p.code,n.cn FROM pharmacies p
  CROSS JOIN farmetrica.nomenclator_presentaciones n
  WHERE ${officialMatch("n")}
 ), movements AS MATERIALIZED (
  SELECT DISTINCT c.pharmacy_id,c.code,c.article_id,
   NULL::text AS supplier_code,true AS from_sales,false AS from_receipts
  FROM candidates c JOIN ${schema}.fm_ventas_analitica v
   ON v.farmacia_codigo=c.code AND v.articulo_id=c.article_id
  UNION ALL
  SELECT DISTINCT c.pharmacy_id,c.code,c.article_id,
   ${supplierCode("r.proveedor_id")},false,true
  FROM candidates c JOIN ${schema}.fm_recepciones_analitica r
   ON r.farmacia_codigo=c.code AND r.articulo_id=c.article_id
 ), activity AS MATERIALIZED (
  SELECT m.pharmacy_id,m.code,m.article_id,m.supplier_code,
   m.from_sales,m.from_receipts,
   coalesce(nullif(btrim(a.nombre),''),n.nombre,m.article_id) AS nombre,
   ${cn} AS cn,
   CASE WHEN n.cn IS NOT NULL THEN 'medicacion'
    WHEN ${cn} ~ '^[0-9]{6,7}$' AND left(${cn},6)::int>=400000
     THEN 'medicacion' ELSE 'parafarmacia' END AS tipo,
   ${retiredProductSQL("a.nombre")} AS inactive,
   CASE WHEN 'N:'||${normalizedLabSQL("a.laboratorio")}=$1
      OR ${officialMatch("n")}
      OR EXISTS (SELECT 1 FROM supplier_links map
       WHERE map.farmacia_id=m.pharmacy_id AND map.supplier_code=m.supplier_code
       AND ('N:'||${normalizedLabSQL("substring(map.laboratory_key from 3)")}
          IN (SELECT key FROM lab_aliases)
         OR map.laboratory_key IN (SELECT key FROM lab_aliases)))
      OR EXISTS (SELECT 1 FROM relevant_receipts rr
       WHERE rr.pharmacy_id=m.pharmacy_id AND rr.article_id=m.article_id)
       THEN true ELSE false END AS belongs,
   n.dcpf,n.generico
  FROM movements m
  LEFT JOIN ${schema}.articulos a
   ON upper(btrim(a.farmacia_codigo))=m.code AND a.origen_id::text=m.article_id
  LEFT JOIN farmetrica.nomenclator_presentaciones n ON n.cn=${cn}
 ), blocked_refs AS MATERIALIZED (
  -- Incluso un medicamento oficial se oculta si Farmatic lo marca de baja.
  -- Las etiquetas se leen de las farmacias seleccionadas, no de otro cliente.
  SELECT DISTINCT ${blockedCN} AS reference
  FROM ${schema}.articulos a JOIN pharmacies p ON upper(btrim(a.farmacia_codigo))=p.code
  WHERE ${retiredProductSQL("a.nombre")} AND ${blockedCN} IS NOT NULL
  UNION
  SELECT DISTINCT coalesce(cn,'ERP:'||pharmacy_id::text||':'||article_id)
  FROM activity WHERE inactive AND belongs
 ), union_catalog AS (
  SELECT n.cn::text AS referencia,n.cn::text AS cn,n.nombre::text AS nombre,
    'medicacion'::text AS tipo,true AS from_master,false AS from_sales,false AS from_receipts,
    NULL::text AS pharmacy_id,n.dcpf,n.generico
  FROM farmetrica.nomenclator_presentaciones n
  WHERE ${officialMatch("n")} AND NOT ${retiredProductSQL("n.nombre")}
  UNION ALL
  SELECT coalesce(cn,'ERP:'||pharmacy_id::text||':'||article_id),
   cn,nombre,tipo,false,from_sales,from_receipts,pharmacy_id::text,dcpf,generico
  FROM activity WHERE belongs AND NOT inactive
 ), summarized AS (
  SELECT referencia,max(cn) AS cn,
   coalesce(min(nombre) FILTER(WHERE from_sales OR from_receipts),
    min(nombre) FILTER(WHERE from_master),min(nombre)) AS nombre,
   CASE WHEN bool_or(tipo='medicacion') THEN 'medicacion' ELSE 'parafarmacia' END AS tipo,
   bool_or(from_master) AS "inMaster",
   bool_or(from_sales OR from_receipts) AS "inReceipts",
   bool_or(from_sales) AS "inSales",
   bool_or(from_receipts) AS "inPurchases",
   string_agg(DISTINCT pharmacy_id,',' ORDER BY pharmacy_id)
     FILTER (WHERE pharmacy_id IS NOT NULL) AS "pharmacyIds",
   max(dcpf) AS dcpf,bool_or(coalesce(generico,false)) AS generic
  FROM union_catalog
  WHERE referencia IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM blocked_refs b WHERE b.reference=union_catalog.referencia)
  GROUP BY referencia
 ), filtered AS (
  SELECT *,("inReceipts" AND NOT "inMaster" AND cn IS NULL) AS provisional
  FROM summarized WHERE tipo=$4 AND
   ($5::text='' OR nombre ILIKE '%'||$5||'%' OR referencia ILIKE '%'||$5||'%')
 )
 SELECT *,count(*) OVER()::int AS total
 FROM filtered ORDER BY nombre,referencia LIMIT $6 OFFSET $7`;
 const {rows}=await pool.query({text:sql,
  values:[key,pharmacies,context.client.slug,type,search,size,(page-1)*size,patterns],
  query_timeout:30000});
 return {rows:rows.map(({total,...row})=>row),total:rows[0]?.total||0,page,size};
}
export async function diagnosticLaboratorySources(pool,context,opts){
 const results=await Promise.allSettled(["medicacion","parafarmacia"].map(type=>
  readDirectLaboratoryCatalog(pool,context,{...opts,type,page:1,size:1,search:""})));
 return {sources:results.map((r,i)=>({type:i===0?"medicacion":"parafarmacia",
  status:r.status==="fulfilled"?"ok":"error",
  total:r.status==="fulfilled"?r.value.total:null})),
  pharmacyCount:opts.pharmacies.length};
}
