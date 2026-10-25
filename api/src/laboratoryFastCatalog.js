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

// Los medicamentos oficiales se pueden servir directamente de AEMPS.
// Nunca deben bloquearse por un JOIN con millones de tickets/albaranes.
async function readOfficialMedicationFast(pool,context,{key,pharmacies,search,page,size,patterns,hasNativeCN}){
 const schema='"'+context.client.schema+'"';
 const blockedCN=`coalesce(${validCN("a.codigo_nacional")},
   ${validCN(hasNativeCN?"a.cn_normalizado":"to_jsonb(a)->>'cn_normalizado'")},
   ${validCN("a.origen_id::text")})`;
 const sql=`
 WITH selected_pharmacies AS (
  SELECT ${pharmacyDataCodeSQL("f")} AS code FROM farmetrica.farmacias f
  WHERE f.cliente_slug=$3 AND f.id=ANY($2::int[])
 ), retired_codes AS MATERIALIZED (
  SELECT DISTINCT ${blockedCN} AS cn FROM ${schema}.articulos a
  JOIN selected_pharmacies p ON upper(btrim(a.farmacia_codigo))=p.code
  WHERE ${retiredProductSQL("a.nombre","$7")}
 ), oficial AS (
  SELECT n.cn::text AS referencia,n.cn::text AS cn,n.nombre::text AS nombre,
   'medicacion'::text AS tipo,true AS "inMaster",
   false AS "inReceipts",false AS "inSales",false AS "inPurchases",
   NULL::text AS "pharmacyIds",n.dcpf,n.generico AS generic,false AS provisional
  FROM farmetrica.nomenclator_presentaciones n
  WHERE ${officialMatch("n")} AND NOT ${retiredProductSQL("n.nombre","$7")}
   AND ($4::text='' OR n.nombre ILIKE '%'||$4||'%' OR n.cn ILIKE '%'||$4||'%')
   AND NOT EXISTS(SELECT 1 FROM retired_codes r WHERE r.cn=n.cn)
 )
 SELECT *,count(*) OVER()::int AS total FROM oficial
 ORDER BY nombre,referencia LIMIT $5 OFFSET $6`;
 const {rows}=await pool.query({text:sql,values:[key,pharmacies,context.client.slug,search,
  size,(page-1)*size,patterns],query_timeout:15000});
 return {rows:rows.map(({total,...row})=>row),total:rows[0]?.total||0,page,size};
}

// Parafarmacia: leer únicamente albaranes del proveedor local o de una
// correspondencia explícita, sobre cabeceras y líneas indexadas del ERP.
// No materializar jamás una unión con todo el histórico de ventas.
async function readParapharmacyFast(pool,context,{key,pharmacies,search,page,size,patterns,hasNativeCN}){
 const schema='"'+context.client.schema+'"';
 const articleCN=`coalesce(${validCN("a.codigo_nacional")},
   ${validCN(hasNativeCN?"a.cn_normalizado":"to_jsonb(a)->>'cn_normalizado'")},
   CASE WHEN EXISTS(SELECT 1 FROM farmetrica.nomenclator_presentaciones known
    WHERE known.cn=btrim(coalesce(a.origen_id::text,c.article_id)))
    THEN ${validCN("coalesce(a.origen_id::text,c.article_id)")} ELSE NULL::text END)`;
 const sql=`
 WITH pharmacies AS (
  SELECT f.id,${pharmacyDataCodeSQL("f")} AS code
  FROM farmetrica.farmacias f WHERE f.cliente_slug=$3 AND f.id=ANY($2::int[])
 ), alias_keys AS MATERIALIZED (
  SELECT $1::text AS key UNION
  SELECT alias.key FROM farmetrica.nomenclator_presentaciones n
  CROSS JOIN LATERAL (VALUES
   (${normalizedLabSQL("n.laboratorio_titular")},n.laboratorio_titular_codigo),
   (${normalizedLabSQL("n.laboratorio_comercializador")},n.laboratorio_comercializador_codigo),
   (${normalizedLabSQL("n.laboratorio")},n.laboratorio_codigo)
  ) AS side(name,code)
  CROSS JOIN LATERAL (VALUES ('N:'||side.name),
   ('C:'||upper(btrim(coalesce(side.code,''))))) AS alias(key)
  WHERE ('N:'||side.name=$1 OR 'C:'||upper(btrim(coalesce(side.code,'')))=$1)
   AND alias.key !~ '^[NC]: presentaciones del Nomenclátor + artículos que figuran en
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
 if(type==="medicacion"){
  // Nomenclátor es fuente oficial suficiente para mostrar las presentaciones
  // de forma inmediata, sin depender de las recepciones históricas.
  const fast=await readOfficialMedicationFast(pool,context,{
   key,pharmacies,search,page,size,patterns,hasNativeCN
  });
  if(fast.total>0)return fast;
 }
 if(type==="parafarmacia"){
  const fast=await readParapharmacyFast(pool,context,{
   key,pharmacies,search,page,size,patterns,hasNativeCN
  });
  if(fast.total>0)return fast;
 }
 const cn= `coalesce(${validCN("a.codigo_nacional")},
   ${validCN(hasNativeCN?"a.cn_normalizado":"to_jsonb(a)->>'cn_normalizado'")},
   CASE WHEN EXISTS(SELECT 1 FROM farmetrica.nomenclator_presentaciones verified
    WHERE verified.cn=btrim(coalesce(a.origen_id::text,c.article_id)))
    THEN ${validCN("coalesce(a.origen_id::text,c.article_id)")} ELSE NULL::text END)`;
 const blockedCN=`coalesce(${validCN("a.codigo_nacional")},
   ${validCN(hasNativeCN?"a.cn_normalizado":"to_jsonb(a)->>'cn_normalizado'")},
   ${validCN("a.origen_id::text")})`;
 const sql=`
 WITH pharmacies AS (
  SELECT f.id,${pharmacyDataCodeSQL("f")} AS code
  FROM farmetrica.farmacias f WHERE f.cliente_slug=$3 AND f.id=ANY($2::int[])
 ), lab_aliases AS MATERIALIZED (
  -- El titular y el comercializador pueden ser empresas distintas.
  -- Enlazar nombres y códigos SOLO del mismo lado AEMPS, no los otros
  -- laboratorios asociados al mismo medicamento.
  SELECT $1::text AS key
  UNION
  SELECT DISTINCT alias.key FROM farmetrica.nomenclator_presentaciones n
  CROSS JOIN LATERAL (VALUES
   (${normalizedLabSQL("n.laboratorio_titular")},n.laboratorio_titular_codigo),
   (${normalizedLabSQL("n.laboratorio_comercializador")},n.laboratorio_comercializador_codigo),
   (${normalizedLabSQL("n.laboratorio")},n.laboratorio_codigo)
  ) AS side(name,code)
  CROSS JOIN LATERAL (VALUES
   ('N:'||side.name),('C:'||upper(btrim(coalesce(side.code,''))))
  ) AS alias(key)
  WHERE ('N:'||side.name=$1 OR 'C:'||upper(btrim(coalesce(side.code,'')))=$1)
   AND alias.key !~ '^[NC]:$'
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
 ), relevant_receipts AS MATERIALIZED (
  -- Filtrar primero por proveedor y farmacia, NO cruzar todos los productos
  -- con todos los movimientos históricos antes de paginar.
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
  -- La vista de recepciones devuelve proveedor_nombre NULL. Recuperar su
  -- denominación del maestro ERP de la misma farmacia, si existe.
  SELECT DISTINCT p.id,p.code,r.articulo_id::text
  FROM pharmacies p JOIN ${schema}.fm_recepciones_analitica r
   ON r.farmacia_codigo=p.code
  LEFT JOIN ${schema}.proveedores sp
   ON upper(btrim(sp.farmacia_codigo))=p.code
   AND ${supplierCode("sp.origen_id")}=${supplierCode("r.proveedor_id")}
  WHERE r.articulo_id IS NOT NULL
   AND 'N:'||${normalizedLabSQL("coalesce(nullif(btrim(r.proveedor_nombre),''),sp.nombre)")}
       IN (SELECT key FROM lab_aliases WHERE key LIKE 'N:%')
   AND NOT EXISTS (SELECT 1 FROM supplier_links link
    WHERE link.farmacia_id=p.id
     AND link.supplier_code=${supplierCode("r.proveedor_id")})
 ), relevant_articles AS MATERIALIZED (
  -- Desde Farmatic obtener solo artículos del laboratorio que han tenido
  -- al menos una venta o recepción. EXISTS usa el índice ERP por producto.
  SELECT p.id AS pharmacy_id,p.code,a.origen_id::text AS article_id
  FROM pharmacies p JOIN ${schema}.articulos a
   ON upper(btrim(a.farmacia_codigo))=p.code
  LEFT JOIN farmetrica.nomenclator_presentaciones n
   ON n.cn=coalesce(${validCN("a.codigo_nacional")},
    ${validCN(hasNativeCN?"a.cn_normalizado":"to_jsonb(a)->>'cn_normalizado'")},
    ${validCN("a.origen_id::text")})
  WHERE nullif(btrim(a.origen_id::text),'') IS NOT NULL
   AND ('N:'||${normalizedLabSQL("a.laboratorio")}=$1 OR ${officialMatch("n")}
    OR EXISTS (SELECT 1 FROM supplier_links link
     WHERE link.farmacia_id=p.id
      AND link.supplier_code=${supplierCode("to_jsonb(a)->>'proveedor_habitual_id'")}
      AND (link.laboratory_key IN (SELECT key FROM lab_aliases)
       OR (link.laboratory_key LIKE 'N:%'
        AND 'N:'||${normalizedLabSQL("substring(link.laboratory_key from 3)")}
         IN (SELECT key FROM lab_aliases)))))
   AND (EXISTS (SELECT 1 FROM ${schema}.fm_ventas_analitica v
     WHERE v.farmacia_codigo=p.code AND v.articulo_id=a.origen_id::text)
    OR EXISTS (SELECT 1 FROM ${schema}.fm_recepciones_analitica r
     WHERE r.farmacia_codigo=p.code AND r.articulo_id=a.origen_id::text))
 ), candidates AS MATERIALIZED (
  SELECT pharmacy_id,code,article_id FROM relevant_receipts
  UNION SELECT pharmacy_id,code,article_id FROM relevant_articles
 ), activity AS MATERIALIZED (
  -- Solo verificaciones EXISTS por cada candidato indexado; antes se
  -- materializaba una unión de TODO el histórico vendido y recibido.
  SELECT c.pharmacy_id,c.code,c.article_id,
   coalesce(nullif(btrim(a.nombre),''),n.nombre,c.article_id) AS nombre,
   ${cn} AS cn,
   CASE WHEN n.cn IS NOT NULL THEN 'medicacion'
    WHEN ${cn} ~ '^[0-9]{6,7}$' AND left(${cn},6)::int>=400000
     THEN 'medicacion' ELSE 'parafarmacia' END AS tipo,
   EXISTS (SELECT 1 FROM ${schema}.fm_ventas_analitica v
    WHERE v.farmacia_codigo=c.code AND v.articulo_id=c.article_id) AS from_sales,
   EXISTS (SELECT 1 FROM ${schema}.fm_recepciones_analitica r
    WHERE r.farmacia_codigo=c.code AND r.articulo_id=c.article_id) AS from_receipts,
   ${retiredProductSQL("a.nombre")} AS inactive,
   CASE WHEN n.cn IS NOT NULL AND NOT ${officialMatch("n")} THEN false
    WHEN 'N:'||${normalizedLabSQL("a.laboratorio")}=$1 OR ${officialMatch("n")}
     OR EXISTS (SELECT 1 FROM relevant_receipts rr
       WHERE rr.pharmacy_id=c.pharmacy_id AND rr.article_id=c.article_id)
     OR EXISTS (SELECT 1 FROM supplier_links usual
       WHERE usual.farmacia_id=c.pharmacy_id
        AND usual.supplier_code=${supplierCode("to_jsonb(a)->>'proveedor_habitual_id'")}
        AND (usual.laboratory_key IN (SELECT key FROM lab_aliases)
         OR (usual.laboratory_key LIKE 'N:%'
          AND 'N:'||${normalizedLabSQL("substring(usual.laboratory_key from 3)")}
           IN (SELECT key FROM lab_aliases))))
       THEN true ELSE false END AS belongs,
   n.dcpf,n.generico
  FROM candidates c
  LEFT JOIN ${schema}.articulos a
   ON upper(btrim(a.farmacia_codigo))=c.code AND a.origen_id::text=c.article_id
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
/** Desglose solo de lectura para distinguir un catálogo vacío de un enlace ERP roto. */
export async function laboratoryLinkEvidence(pool,context,{key,pharmacies}){
 if(!SCHEMA.test(context.client.schema))throw Error("Esquema no autorizado");
 const schema='"'+context.client.schema+'"';
 const sql=`
 WITH pharmacies AS (
  SELECT f.id,${pharmacyDataCodeSQL("f")} AS code
  FROM farmetrica.farmacias f WHERE f.cliente_slug=$2 AND f.id=ANY($3::int[])
 )
 SELECT
  (SELECT count(*)::int FROM farmetrica.nomenclator_presentaciones n
   WHERE ${officialMatch("n")}) AS "official",
  (SELECT count(*)::int FROM ${schema}.articulos a JOIN pharmacies p
   ON upper(btrim(a.farmacia_codigo))=p.code
   WHERE 'N:'||${normalizedLabSQL("a.laboratorio")}=$1) AS "erpArticles",
  (SELECT count(*)::int FROM ${schema}.proveedores sp JOIN pharmacies p
   ON upper(btrim(sp.farmacia_codigo))=p.code
   WHERE 'N:'||${normalizedLabSQL("sp.nombre")}=$1) AS "erpSuppliers",
  (SELECT count(DISTINCT r.origen_id)::int FROM ${schema}.fm_recepciones_analitica r
   JOIN pharmacies p ON r.farmacia_codigo=p.code
   JOIN ${schema}.proveedores sp
    ON upper(btrim(sp.farmacia_codigo))=p.code
     AND ${supplierCode("sp.origen_id")}=${supplierCode("r.proveedor_id")}
   WHERE 'N:'||${normalizedLabSQL("sp.nombre")}=$1) AS "purchasesWithNamedSupplier",
  (SELECT count(DISTINCT r.origen_id)::int FROM ${schema}.fm_recepciones_analitica r
   JOIN pharmacies p ON r.farmacia_codigo=p.code
   JOIN farmetrica.proveedores_laboratorios m
    ON m.cliente_slug=$2 AND m.farmacia_id=p.id
     AND ${supplierCode("m.codigo_proveedor")}=${supplierCode("r.proveedor_id")}
   WHERE m.laboratorio_clave=$1) AS "purchasesWithManualLink"
 `;
 const {rows}=await pool.query({text:sql,values:[key,context.client.slug,pharmacies],query_timeout:15000});
 return rows[0]||null;
}
export async function diagnosticLaboratorySources(pool,context,opts){
 const results=await Promise.allSettled(["medicacion","parafarmacia"].map(type=>
  readDirectLaboratoryCatalog(pool,context,{...opts,type,page:1,size:1,search:""})));
 let evidence=null,evidenceError=null;
 try{evidence=await laboratoryLinkEvidence(pool,context,opts)}
 catch(e){evidenceError=e.code||"Consulta de origen no disponible";}
 return {sources:results.map((r,i)=>({
   type:i===0?"medicacion":"parafarmacia",
   status:r.status==="fulfilled"?"ok":"error",
   total:r.status==="fulfilled"?r.value.total:null,
   errorCode:r.status==="rejected"?r.reason?.code||"ERROR":null
  })),evidence,evidenceError,
  pharmacyCount:opts.pharmacies.length};
}

 ), supplier_links AS MATERIALIZED (
  SELECT p.id AS pharmacy_id,${supplierCode("sp.origen_id")} AS supplier_code
  FROM pharmacies p JOIN ${schema}.proveedores sp
   ON upper(btrim(sp.farmacia_codigo))=p.code
  WHERE 'N:'||${normalizedLabSQL("sp.nombre")}
     IN (SELECT key FROM alias_keys WHERE key LIKE 'N:%')
   AND NOT EXISTS (SELECT 1 FROM farmetrica.proveedores_laboratorios m
    WHERE m.cliente_slug=$3 AND m.farmacia_id=p.id
     AND ${supplierCode("m.codigo_proveedor")}=${supplierCode("sp.origen_id")}
     AND m.laboratorio_clave NOT IN (SELECT key FROM alias_keys))
   AND NOT EXISTS (SELECT 1 FROM farmetrica.proveedores_maestro pm
    WHERE pm.cliente_slug=$3 AND pm.cooperativa=true
     AND ${supplierCode("pm.codigo_origen")}=${supplierCode("sp.origen_id")}
     AND ${normalizedLabSQL("pm.nombre")}=${normalizedLabSQL("sp.nombre")})
  UNION
  SELECT m.farmacia_id,${supplierCode("m.codigo_proveedor")}
  FROM farmetrica.proveedores_laboratorios m JOIN pharmacies p ON p.id=m.farmacia_id
  WHERE m.cliente_slug=$3 AND m.laboratorio_clave IN (SELECT key FROM alias_keys)
  UNION
  SELECT p.id,${supplierCode("pm.codigo_origen")}
  FROM farmetrica.proveedores_maestro pm
  JOIN pharmacies p ON true
  JOIN ${schema}.proveedores sp ON upper(btrim(sp.farmacia_codigo))=p.code
   AND ${supplierCode("sp.origen_id")}=${supplierCode("pm.codigo_origen")}
   AND ${normalizedLabSQL("sp.nombre")}=${normalizedLabSQL("pm.nombre")}
  WHERE pm.cliente_slug=$3 AND pm.cooperativa IS NOT TRUE
   AND pm.laboratorio_clave IN (SELECT key FROM alias_keys)
   AND NOT EXISTS (SELECT 1 FROM farmetrica.proveedores_laboratorios m
    WHERE m.cliente_slug=$3 AND m.farmacia_id=p.id
     AND ${supplierCode("m.codigo_proveedor")}=${supplierCode("pm.codigo_origen")})
 ), purchased AS MATERIALIZED (
  SELECT DISTINCT p.id AS pharmacy_id,p.code,l.articulo_origen_id::text AS article_id
  FROM pharmacies p
  JOIN ${schema}.fm_recepciones_cabeceras h ON h.farmacia_codigo=p.code
  JOIN supplier_links link ON link.pharmacy_id=p.id
   AND link.supplier_code=${supplierCode("h.proveedor_origen_id")}
  JOIN ${schema}.fm_recepciones_lineas l
   ON l.farmacia_codigo=h.farmacia_codigo AND l.sistema_origen=h.sistema_origen
    AND l.documento_id=h.documento_id
  WHERE h.lineas_completas AND NOT h.eliminada_logicamente
   AND NOT l.eliminada_logicamente
   AND lower(btrim(h.estado)) NOT IN ('anulado','anulada','cancelado','cancelada','void')
   AND l.articulo_origen_id IS NOT NULL
 ), erp_sales AS MATERIALIZED (
  SELECT p.id AS pharmacy_id,p.code,a.origen_id::text AS article_id
  FROM pharmacies p JOIN ${schema}.articulos a
   ON upper(btrim(a.farmacia_codigo))=p.code
  WHERE 'N:'||${normalizedLabSQL("a.laboratorio")}=$1
   AND EXISTS(SELECT 1 FROM ${schema}.fm_ventas_analitica v
    WHERE v.farmacia_codigo=p.code AND v.articulo_id=a.origen_id::text)
 ), candidates AS MATERIALIZED (
  SELECT pharmacy_id,code,article_id FROM purchased
  UNION SELECT pharmacy_id,code,article_id FROM erp_sales
 ), activity AS (
  SELECT c.pharmacy_id,c.code,c.article_id,
   ${articleCN} AS cn,
   coalesce(nullif(btrim(a.nombre),''),n.nombre,c.article_id) AS nombre,
   CASE WHEN n.cn IS NOT NULL OR
     (${articleCN} ~ '^[0-9]{6,7} presentaciones del Nomenclátor + artículos que figuran en
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
 if(type==="medicacion"){
  // Nomenclátor es fuente oficial suficiente para mostrar las presentaciones
  // de forma inmediata, sin depender de las recepciones históricas.
  const fast=await readOfficialMedicationFast(pool,context,{
   key,pharmacies,search,page,size,patterns,hasNativeCN
  });
  if(fast.total>0)return fast;
 }
 const cn= `coalesce(${validCN("a.codigo_nacional")},
   ${validCN(hasNativeCN?"a.cn_normalizado":"to_jsonb(a)->>'cn_normalizado'")},
   CASE WHEN EXISTS(SELECT 1 FROM farmetrica.nomenclator_presentaciones verified
    WHERE verified.cn=btrim(coalesce(a.origen_id::text,c.article_id)))
    THEN ${validCN("coalesce(a.origen_id::text,c.article_id)")} ELSE NULL::text END)`;
 const blockedCN=`coalesce(${validCN("a.codigo_nacional")},
   ${validCN(hasNativeCN?"a.cn_normalizado":"to_jsonb(a)->>'cn_normalizado'")},
   ${validCN("a.origen_id::text")})`;
 const sql=`
 WITH pharmacies AS (
  SELECT f.id,${pharmacyDataCodeSQL("f")} AS code
  FROM farmetrica.farmacias f WHERE f.cliente_slug=$3 AND f.id=ANY($2::int[])
 ), lab_aliases AS MATERIALIZED (
  -- El titular y el comercializador pueden ser empresas distintas.
  -- Enlazar nombres y códigos SOLO del mismo lado AEMPS, no los otros
  -- laboratorios asociados al mismo medicamento.
  SELECT $1::text AS key
  UNION
  SELECT DISTINCT alias.key FROM farmetrica.nomenclator_presentaciones n
  CROSS JOIN LATERAL (VALUES
   (${normalizedLabSQL("n.laboratorio_titular")},n.laboratorio_titular_codigo),
   (${normalizedLabSQL("n.laboratorio_comercializador")},n.laboratorio_comercializador_codigo),
   (${normalizedLabSQL("n.laboratorio")},n.laboratorio_codigo)
  ) AS side(name,code)
  CROSS JOIN LATERAL (VALUES
   ('N:'||side.name),('C:'||upper(btrim(coalesce(side.code,''))))
  ) AS alias(key)
  WHERE ('N:'||side.name=$1 OR 'C:'||upper(btrim(coalesce(side.code,'')))=$1)
   AND alias.key !~ '^[NC]:$'
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
 ), relevant_receipts AS MATERIALIZED (
  -- Filtrar primero por proveedor y farmacia, NO cruzar todos los productos
  -- con todos los movimientos históricos antes de paginar.
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
  -- La vista de recepciones devuelve proveedor_nombre NULL. Recuperar su
  -- denominación del maestro ERP de la misma farmacia, si existe.
  SELECT DISTINCT p.id,p.code,r.articulo_id::text
  FROM pharmacies p JOIN ${schema}.fm_recepciones_analitica r
   ON r.farmacia_codigo=p.code
  LEFT JOIN ${schema}.proveedores sp
   ON upper(btrim(sp.farmacia_codigo))=p.code
   AND ${supplierCode("sp.origen_id")}=${supplierCode("r.proveedor_id")}
  WHERE r.articulo_id IS NOT NULL
   AND 'N:'||${normalizedLabSQL("coalesce(nullif(btrim(r.proveedor_nombre),''),sp.nombre)")}
       IN (SELECT key FROM lab_aliases WHERE key LIKE 'N:%')
   AND NOT EXISTS (SELECT 1 FROM supplier_links link
    WHERE link.farmacia_id=p.id
     AND link.supplier_code=${supplierCode("r.proveedor_id")})
 ), relevant_articles AS MATERIALIZED (
  -- Desde Farmatic obtener solo artículos del laboratorio que han tenido
  -- al menos una venta o recepción. EXISTS usa el índice ERP por producto.
  SELECT p.id AS pharmacy_id,p.code,a.origen_id::text AS article_id
  FROM pharmacies p JOIN ${schema}.articulos a
   ON upper(btrim(a.farmacia_codigo))=p.code
  LEFT JOIN farmetrica.nomenclator_presentaciones n
   ON n.cn=coalesce(${validCN("a.codigo_nacional")},
    ${validCN(hasNativeCN?"a.cn_normalizado":"to_jsonb(a)->>'cn_normalizado'")},
    ${validCN("a.origen_id::text")})
  WHERE nullif(btrim(a.origen_id::text),'') IS NOT NULL
   AND ('N:'||${normalizedLabSQL("a.laboratorio")}=$1 OR ${officialMatch("n")}
    OR EXISTS (SELECT 1 FROM supplier_links link
     WHERE link.farmacia_id=p.id
      AND link.supplier_code=${supplierCode("to_jsonb(a)->>'proveedor_habitual_id'")}
      AND (link.laboratory_key IN (SELECT key FROM lab_aliases)
       OR (link.laboratory_key LIKE 'N:%'
        AND 'N:'||${normalizedLabSQL("substring(link.laboratory_key from 3)")}
         IN (SELECT key FROM lab_aliases)))))
   AND (EXISTS (SELECT 1 FROM ${schema}.fm_ventas_analitica v
     WHERE v.farmacia_codigo=p.code AND v.articulo_id=a.origen_id::text)
    OR EXISTS (SELECT 1 FROM ${schema}.fm_recepciones_analitica r
     WHERE r.farmacia_codigo=p.code AND r.articulo_id=a.origen_id::text))
 ), candidates AS MATERIALIZED (
  SELECT pharmacy_id,code,article_id FROM relevant_receipts
  UNION SELECT pharmacy_id,code,article_id FROM relevant_articles
 ), activity AS MATERIALIZED (
  -- Solo verificaciones EXISTS por cada candidato indexado; antes se
  -- materializaba una unión de TODO el histórico vendido y recibido.
  SELECT c.pharmacy_id,c.code,c.article_id,
   coalesce(nullif(btrim(a.nombre),''),n.nombre,c.article_id) AS nombre,
   ${cn} AS cn,
   CASE WHEN n.cn IS NOT NULL THEN 'medicacion'
    WHEN ${cn} ~ '^[0-9]{6,7}$' AND left(${cn},6)::int>=400000
     THEN 'medicacion' ELSE 'parafarmacia' END AS tipo,
   EXISTS (SELECT 1 FROM ${schema}.fm_ventas_analitica v
    WHERE v.farmacia_codigo=c.code AND v.articulo_id=c.article_id) AS from_sales,
   EXISTS (SELECT 1 FROM ${schema}.fm_recepciones_analitica r
    WHERE r.farmacia_codigo=c.code AND r.articulo_id=c.article_id) AS from_receipts,
   ${retiredProductSQL("a.nombre")} AS inactive,
   CASE WHEN n.cn IS NOT NULL AND NOT ${officialMatch("n")} THEN false
    WHEN 'N:'||${normalizedLabSQL("a.laboratorio")}=$1 OR ${officialMatch("n")}
     OR EXISTS (SELECT 1 FROM relevant_receipts rr
       WHERE rr.pharmacy_id=c.pharmacy_id AND rr.article_id=c.article_id)
     OR EXISTS (SELECT 1 FROM supplier_links usual
       WHERE usual.farmacia_id=c.pharmacy_id
        AND usual.supplier_code=${supplierCode("to_jsonb(a)->>'proveedor_habitual_id'")}
        AND (usual.laboratory_key IN (SELECT key FROM lab_aliases)
         OR (usual.laboratory_key LIKE 'N:%'
          AND 'N:'||${normalizedLabSQL("substring(usual.laboratory_key from 3)")}
           IN (SELECT key FROM lab_aliases))))
       THEN true ELSE false END AS belongs,
   n.dcpf,n.generico
  FROM candidates c
  LEFT JOIN ${schema}.articulos a
   ON upper(btrim(a.farmacia_codigo))=c.code AND a.origen_id::text=c.article_id
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
/** Desglose solo de lectura para distinguir un catálogo vacío de un enlace ERP roto. */
export async function laboratoryLinkEvidence(pool,context,{key,pharmacies}){
 if(!SCHEMA.test(context.client.schema))throw Error("Esquema no autorizado");
 const schema='"'+context.client.schema+'"';
 const sql=`
 WITH pharmacies AS (
  SELECT f.id,${pharmacyDataCodeSQL("f")} AS code
  FROM farmetrica.farmacias f WHERE f.cliente_slug=$2 AND f.id=ANY($3::int[])
 )
 SELECT
  (SELECT count(*)::int FROM farmetrica.nomenclator_presentaciones n
   WHERE ${officialMatch("n")}) AS "official",
  (SELECT count(*)::int FROM ${schema}.articulos a JOIN pharmacies p
   ON upper(btrim(a.farmacia_codigo))=p.code
   WHERE 'N:'||${normalizedLabSQL("a.laboratorio")}=$1) AS "erpArticles",
  (SELECT count(*)::int FROM ${schema}.proveedores sp JOIN pharmacies p
   ON upper(btrim(sp.farmacia_codigo))=p.code
   WHERE 'N:'||${normalizedLabSQL("sp.nombre")}=$1) AS "erpSuppliers",
  (SELECT count(DISTINCT r.origen_id)::int FROM ${schema}.fm_recepciones_analitica r
   JOIN pharmacies p ON r.farmacia_codigo=p.code
   JOIN ${schema}.proveedores sp
    ON upper(btrim(sp.farmacia_codigo))=p.code
     AND ${supplierCode("sp.origen_id")}=${supplierCode("r.proveedor_id")}
   WHERE 'N:'||${normalizedLabSQL("sp.nombre")}=$1) AS "purchasesWithNamedSupplier",
  (SELECT count(DISTINCT r.origen_id)::int FROM ${schema}.fm_recepciones_analitica r
   JOIN pharmacies p ON r.farmacia_codigo=p.code
   JOIN farmetrica.proveedores_laboratorios m
    ON m.cliente_slug=$2 AND m.farmacia_id=p.id
     AND ${supplierCode("m.codigo_proveedor")}=${supplierCode("r.proveedor_id")}
   WHERE m.laboratorio_clave=$1) AS "purchasesWithManualLink"
 `;
 const {rows}=await pool.query({text:sql,values:[key,context.client.slug,pharmacies],query_timeout:15000});
 return rows[0]||null;
}
export async function diagnosticLaboratorySources(pool,context,opts){
 const results=await Promise.allSettled(["medicacion","parafarmacia"].map(type=>
  readDirectLaboratoryCatalog(pool,context,{...opts,type,page:1,size:1,search:""})));
 let evidence=null,evidenceError=null;
 try{evidence=await laboratoryLinkEvidence(pool,context,opts)}
 catch(e){evidenceError=e.code||"Consulta de origen no disponible";}
 return {sources:results.map((r,i)=>({
   type:i===0?"medicacion":"parafarmacia",
   status:r.status==="fulfilled"?"ok":"error",
   total:r.status==="fulfilled"?r.value.total:null,
   errorCode:r.status==="rejected"?r.reason?.code||"ERROR":null
  })),evidence,evidenceError,
  pharmacyCount:opts.pharmacies.length};
}
 AND left(${articleCN},6)::int>=400000)
      THEN 'medicacion' ELSE 'parafarmacia' END AS tipo,
   EXISTS(SELECT 1 FROM ${schema}.fm_ventas_analitica v
    WHERE v.farmacia_codigo=c.code AND v.articulo_id=c.article_id) AS sold,
   EXISTS(SELECT 1 FROM purchased pp
    WHERE pp.pharmacy_id=c.pharmacy_id AND pp.article_id=c.article_id) AS bought,
   ${retiredProductSQL("a.nombre","$7")} AS inactive,
   (n.cn IS NULL OR ${officialMatch("n")}) AS valid_lab
  FROM candidates c
  LEFT JOIN ${schema}.articulos a
   ON upper(btrim(a.farmacia_codigo))=c.code AND a.origen_id::text=c.article_id
  LEFT JOIN farmetrica.nomenclator_presentaciones n ON n.cn=${articleCN}
 ), summarized AS (
  SELECT coalesce(cn,'ERP:'||pharmacy_id::text||':'||article_id) AS referencia,
   max(cn) AS cn,min(nombre) AS nombre,'parafarmacia'::text AS tipo,
   false AS "inMaster",bool_or(bought OR sold) AS "inReceipts",
   bool_or(sold) AS "inSales",bool_or(bought) AS "inPurchases",
   string_agg(DISTINCT pharmacy_id::text,',' ORDER BY pharmacy_id::text) AS "pharmacyIds",
   NULL::text AS dcpf,false AS generic,
   bool_and(cn IS NULL) AS provisional
  FROM activity
  WHERE tipo='parafarmacia' AND NOT inactive AND valid_lab
  GROUP BY coalesce(cn,'ERP:'||pharmacy_id::text||':'||article_id)
 ), filtered AS (
  SELECT * FROM summarized
  WHERE ($4::text='' OR nombre ILIKE '%'||$4||'%' OR referencia ILIKE '%'||$4||'%')
 )
 SELECT *,count(*) OVER()::int AS total FROM filtered
 ORDER BY nombre,referencia LIMIT $5 OFFSET $6`;
 const {rows}=await pool.query({text:sql,values:[key,pharmacies,context.client.slug,search,
  size,(page-1)*size,patterns],query_timeout:20000});
 return {rows:rows.map(({total,...row})=>row),total:rows[0]?.total||0,page,size};
}

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
 if(type==="medicacion"){
  // Nomenclátor es fuente oficial suficiente para mostrar las presentaciones
  // de forma inmediata, sin depender de las recepciones históricas.
  const fast=await readOfficialMedicationFast(pool,context,{
   key,pharmacies,search,page,size,patterns,hasNativeCN
  });
  if(fast.total>0)return fast;
 }
 const cn= `coalesce(${validCN("a.codigo_nacional")},
   ${validCN(hasNativeCN?"a.cn_normalizado":"to_jsonb(a)->>'cn_normalizado'")},
   CASE WHEN EXISTS(SELECT 1 FROM farmetrica.nomenclator_presentaciones verified
    WHERE verified.cn=btrim(coalesce(a.origen_id::text,c.article_id)))
    THEN ${validCN("coalesce(a.origen_id::text,c.article_id)")} ELSE NULL::text END)`;
 const blockedCN=`coalesce(${validCN("a.codigo_nacional")},
   ${validCN(hasNativeCN?"a.cn_normalizado":"to_jsonb(a)->>'cn_normalizado'")},
   ${validCN("a.origen_id::text")})`;
 const sql=`
 WITH pharmacies AS (
  SELECT f.id,${pharmacyDataCodeSQL("f")} AS code
  FROM farmetrica.farmacias f WHERE f.cliente_slug=$3 AND f.id=ANY($2::int[])
 ), lab_aliases AS MATERIALIZED (
  -- El titular y el comercializador pueden ser empresas distintas.
  -- Enlazar nombres y códigos SOLO del mismo lado AEMPS, no los otros
  -- laboratorios asociados al mismo medicamento.
  SELECT $1::text AS key
  UNION
  SELECT DISTINCT alias.key FROM farmetrica.nomenclator_presentaciones n
  CROSS JOIN LATERAL (VALUES
   (${normalizedLabSQL("n.laboratorio_titular")},n.laboratorio_titular_codigo),
   (${normalizedLabSQL("n.laboratorio_comercializador")},n.laboratorio_comercializador_codigo),
   (${normalizedLabSQL("n.laboratorio")},n.laboratorio_codigo)
  ) AS side(name,code)
  CROSS JOIN LATERAL (VALUES
   ('N:'||side.name),('C:'||upper(btrim(coalesce(side.code,''))))
  ) AS alias(key)
  WHERE ('N:'||side.name=$1 OR 'C:'||upper(btrim(coalesce(side.code,'')))=$1)
   AND alias.key !~ '^[NC]:$'
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
 ), relevant_receipts AS MATERIALIZED (
  -- Filtrar primero por proveedor y farmacia, NO cruzar todos los productos
  -- con todos los movimientos históricos antes de paginar.
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
  -- La vista de recepciones devuelve proveedor_nombre NULL. Recuperar su
  -- denominación del maestro ERP de la misma farmacia, si existe.
  SELECT DISTINCT p.id,p.code,r.articulo_id::text
  FROM pharmacies p JOIN ${schema}.fm_recepciones_analitica r
   ON r.farmacia_codigo=p.code
  LEFT JOIN ${schema}.proveedores sp
   ON upper(btrim(sp.farmacia_codigo))=p.code
   AND ${supplierCode("sp.origen_id")}=${supplierCode("r.proveedor_id")}
  WHERE r.articulo_id IS NOT NULL
   AND 'N:'||${normalizedLabSQL("coalesce(nullif(btrim(r.proveedor_nombre),''),sp.nombre)")}
       IN (SELECT key FROM lab_aliases WHERE key LIKE 'N:%')
   AND NOT EXISTS (SELECT 1 FROM supplier_links link
    WHERE link.farmacia_id=p.id
     AND link.supplier_code=${supplierCode("r.proveedor_id")})
 ), relevant_articles AS MATERIALIZED (
  -- Desde Farmatic obtener solo artículos del laboratorio que han tenido
  -- al menos una venta o recepción. EXISTS usa el índice ERP por producto.
  SELECT p.id AS pharmacy_id,p.code,a.origen_id::text AS article_id
  FROM pharmacies p JOIN ${schema}.articulos a
   ON upper(btrim(a.farmacia_codigo))=p.code
  LEFT JOIN farmetrica.nomenclator_presentaciones n
   ON n.cn=coalesce(${validCN("a.codigo_nacional")},
    ${validCN(hasNativeCN?"a.cn_normalizado":"to_jsonb(a)->>'cn_normalizado'")},
    ${validCN("a.origen_id::text")})
  WHERE nullif(btrim(a.origen_id::text),'') IS NOT NULL
   AND ('N:'||${normalizedLabSQL("a.laboratorio")}=$1 OR ${officialMatch("n")}
    OR EXISTS (SELECT 1 FROM supplier_links link
     WHERE link.farmacia_id=p.id
      AND link.supplier_code=${supplierCode("to_jsonb(a)->>'proveedor_habitual_id'")}
      AND (link.laboratory_key IN (SELECT key FROM lab_aliases)
       OR (link.laboratory_key LIKE 'N:%'
        AND 'N:'||${normalizedLabSQL("substring(link.laboratory_key from 3)")}
         IN (SELECT key FROM lab_aliases)))))
   AND (EXISTS (SELECT 1 FROM ${schema}.fm_ventas_analitica v
     WHERE v.farmacia_codigo=p.code AND v.articulo_id=a.origen_id::text)
    OR EXISTS (SELECT 1 FROM ${schema}.fm_recepciones_analitica r
     WHERE r.farmacia_codigo=p.code AND r.articulo_id=a.origen_id::text))
 ), candidates AS MATERIALIZED (
  SELECT pharmacy_id,code,article_id FROM relevant_receipts
  UNION SELECT pharmacy_id,code,article_id FROM relevant_articles
 ), activity AS MATERIALIZED (
  -- Solo verificaciones EXISTS por cada candidato indexado; antes se
  -- materializaba una unión de TODO el histórico vendido y recibido.
  SELECT c.pharmacy_id,c.code,c.article_id,
   coalesce(nullif(btrim(a.nombre),''),n.nombre,c.article_id) AS nombre,
   ${cn} AS cn,
   CASE WHEN n.cn IS NOT NULL THEN 'medicacion'
    WHEN ${cn} ~ '^[0-9]{6,7}$' AND left(${cn},6)::int>=400000
     THEN 'medicacion' ELSE 'parafarmacia' END AS tipo,
   EXISTS (SELECT 1 FROM ${schema}.fm_ventas_analitica v
    WHERE v.farmacia_codigo=c.code AND v.articulo_id=c.article_id) AS from_sales,
   EXISTS (SELECT 1 FROM ${schema}.fm_recepciones_analitica r
    WHERE r.farmacia_codigo=c.code AND r.articulo_id=c.article_id) AS from_receipts,
   ${retiredProductSQL("a.nombre")} AS inactive,
   CASE WHEN n.cn IS NOT NULL AND NOT ${officialMatch("n")} THEN false
    WHEN 'N:'||${normalizedLabSQL("a.laboratorio")}=$1 OR ${officialMatch("n")}
     OR EXISTS (SELECT 1 FROM relevant_receipts rr
       WHERE rr.pharmacy_id=c.pharmacy_id AND rr.article_id=c.article_id)
     OR EXISTS (SELECT 1 FROM supplier_links usual
       WHERE usual.farmacia_id=c.pharmacy_id
        AND usual.supplier_code=${supplierCode("to_jsonb(a)->>'proveedor_habitual_id'")}
        AND (usual.laboratory_key IN (SELECT key FROM lab_aliases)
         OR (usual.laboratory_key LIKE 'N:%'
          AND 'N:'||${normalizedLabSQL("substring(usual.laboratory_key from 3)")}
           IN (SELECT key FROM lab_aliases))))
       THEN true ELSE false END AS belongs,
   n.dcpf,n.generico
  FROM candidates c
  LEFT JOIN ${schema}.articulos a
   ON upper(btrim(a.farmacia_codigo))=c.code AND a.origen_id::text=c.article_id
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
/** Desglose solo de lectura para distinguir un catálogo vacío de un enlace ERP roto. */
export async function laboratoryLinkEvidence(pool,context,{key,pharmacies}){
 if(!SCHEMA.test(context.client.schema))throw Error("Esquema no autorizado");
 const schema='"'+context.client.schema+'"';
 const sql=`
 WITH pharmacies AS (
  SELECT f.id,${pharmacyDataCodeSQL("f")} AS code
  FROM farmetrica.farmacias f WHERE f.cliente_slug=$2 AND f.id=ANY($3::int[])
 )
 SELECT
  (SELECT count(*)::int FROM farmetrica.nomenclator_presentaciones n
   WHERE ${officialMatch("n")}) AS "official",
  (SELECT count(*)::int FROM ${schema}.articulos a JOIN pharmacies p
   ON upper(btrim(a.farmacia_codigo))=p.code
   WHERE 'N:'||${normalizedLabSQL("a.laboratorio")}=$1) AS "erpArticles",
  (SELECT count(*)::int FROM ${schema}.proveedores sp JOIN pharmacies p
   ON upper(btrim(sp.farmacia_codigo))=p.code
   WHERE 'N:'||${normalizedLabSQL("sp.nombre")}=$1) AS "erpSuppliers",
  (SELECT count(DISTINCT r.origen_id)::int FROM ${schema}.fm_recepciones_analitica r
   JOIN pharmacies p ON r.farmacia_codigo=p.code
   JOIN ${schema}.proveedores sp
    ON upper(btrim(sp.farmacia_codigo))=p.code
     AND ${supplierCode("sp.origen_id")}=${supplierCode("r.proveedor_id")}
   WHERE 'N:'||${normalizedLabSQL("sp.nombre")}=$1) AS "purchasesWithNamedSupplier",
  (SELECT count(DISTINCT r.origen_id)::int FROM ${schema}.fm_recepciones_analitica r
   JOIN pharmacies p ON r.farmacia_codigo=p.code
   JOIN farmetrica.proveedores_laboratorios m
    ON m.cliente_slug=$2 AND m.farmacia_id=p.id
     AND ${supplierCode("m.codigo_proveedor")}=${supplierCode("r.proveedor_id")}
   WHERE m.laboratorio_clave=$1) AS "purchasesWithManualLink"
 `;
 const {rows}=await pool.query({text:sql,values:[key,context.client.slug,pharmacies],query_timeout:15000});
 return rows[0]||null;
}
export async function diagnosticLaboratorySources(pool,context,opts){
 const results=await Promise.allSettled(["medicacion","parafarmacia"].map(type=>
  readDirectLaboratoryCatalog(pool,context,{...opts,type,page:1,size:1,search:""})));
 let evidence=null,evidenceError=null;
 try{evidence=await laboratoryLinkEvidence(pool,context,opts)}
 catch(e){evidenceError=e.code||"Consulta de origen no disponible";}
 return {sources:results.map((r,i)=>({
   type:i===0?"medicacion":"parafarmacia",
   status:r.status==="fulfilled"?"ok":"error",
   total:r.status==="fulfilled"?r.value.total:null,
   errorCode:r.status==="rejected"?r.reason?.code||"ERROR":null
  })),evidence,evidenceError,
  pharmacyCount:opts.pharmacies.length};
}
