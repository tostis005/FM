import {normalizedLabSQL} from "./laboratoryIdentity.js";
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";

const SCHEMA=/^[a-z][a-z0-9_]{1,62}$/;
const cn=expr=>`CASE WHEN btrim(coalesce(${expr}::text,'')) ~ '^[0-9]{6,7}$'
 THEN btrim(${expr}::text) ELSE NULL::text END`;
const supplierCode=expr=>`CASE WHEN btrim(coalesce(${expr}::text,'')) ~ '^[0-9]+$'
 THEN coalesce(nullif(ltrim(btrim(${expr}::text),'0'),''),'0')
 ELSE upper(btrim(coalesce(${expr}::text,''))) END`;

/**
 * Claves de laboratorios con datos PROPIOS de las farmacias consultadas.
 * El Nomenclátor solo da nombre a un CN que está en Farmatic; por sí solo
 * NO es prueba de actividad. Los albaranes completos son la otra fuente.
 * No se actualiza ninguna correspondencia al consultar.
 */
export async function readOperationalLaboratoryEvidence(pool,context,pharmacies){
 if(!SCHEMA.test(context.client.schema))throw Error("Esquema no autorizado");
 if(!pharmacies.length)return [];
 const schema='"'+context.client.schema+'"';
 let nativeCN=false;
 try{
  const info=await pool.query({text:`
   SELECT EXISTS(SELECT 1 FROM information_schema.columns
    WHERE table_schema=$1 AND table_name='articulos'
     AND column_name='cn_normalizado') AS available`,
   values:[context.client.schema],query_timeout:1500});
  nativeCN=info.rows[0]?.available===true;
 }catch{}
 const declared=`coalesce(${cn("a.codigo_nacional")},
   ${cn(nativeCN?"a.cn_normalizado":"to_jsonb(a)->>'cn_normalizado'")})`;
 const originalId=cn("a.origen_id::text");
 const sql=`
 WITH selected AS (
  SELECT f.id,${pharmacyDataCodeSQL("f")} AS code
  FROM farmetrica.farmacias f WHERE f.cliente_slug=$1 AND f.id=ANY($2::int[])
 ), erp_cn AS MATERIALIZED (
  SELECT p.id AS pharmacy_id,p.code,
   coalesce(${declared},origin.cn) AS cn,
   a.laboratorio AS local_lab,
   (${declared} IS NOT NULL) AS declared_cn
  FROM ${schema}.articulos a JOIN selected p
   ON upper(btrim(a.farmacia_codigo))=p.code
  LEFT JOIN farmetrica.nomenclator_presentaciones origin
   ON origin.cn=${originalId}
  WHERE ${declared} IS NOT NULL OR origin.cn IS NOT NULL
 ), erp_evidence AS (
  SELECT 'N:'||lab.name AS key,min(lab.display_name) AS name,
   bool_or(n.cn IS NOT NULL OR left(erp.cn,6)::integer>=400000) AS medication,
   bool_or(n.cn IS NULL AND left(erp.cn,6)::integer<400000) AS parapharmacy
  FROM erp_cn erp
  LEFT JOIN farmetrica.nomenclator_presentaciones n ON n.cn=erp.cn
  CROSS JOIN LATERAL (VALUES
   (${normalizedLabSQL("erp.local_lab")},erp.local_lab),
   (${normalizedLabSQL("n.laboratorio_titular")},n.laboratorio_titular),
   (${normalizedLabSQL("n.laboratorio_comercializador")},n.laboratorio_comercializador),
   (${normalizedLabSQL("n.laboratorio")},n.laboratorio)
  ) AS lab(name,display_name)
  WHERE lab.name<>'' AND
   -- El ID de artículo puede ser un código local, NO un CN. Solo es válido
   -- si el Nomenclátor confirma ese ID o Farmatic declara un CN.
   (n.cn IS NOT NULL OR erp.declared_cn)
  GROUP BY lab.name
 ), received_suppliers AS MATERIALIZED (
  -- Leer cabeceras de albaranes (no todas las líneas históricas).
  SELECT DISTINCT p.id AS pharmacy_id,p.code,
   ${supplierCode("h.proveedor_origen_id")} AS supplier
  FROM ${schema}.fm_recepciones_cabeceras h JOIN selected p
   ON h.farmacia_codigo=p.code
  WHERE h.lineas_completas AND NOT h.eliminada_logicamente
   AND lower(btrim(h.estado)) NOT IN ('anulado','anulada','cancelado','cancelada','void')
   AND nullif(btrim(h.proveedor_origen_id),'') IS NOT NULL
 ), receipt_mappings AS MATERIALIZED (
  SELECT r.pharmacy_id,
   coalesce(m.laboratorio_clave,pm.laboratorio_clave,
    CASE WHEN sp.nombre IS NOT NULL THEN
     'N:'||${normalizedLabSQL("sp.nombre")} END) AS lab_key
  FROM received_suppliers r
  LEFT JOIN ${schema}.proveedores sp
   ON upper(btrim(sp.farmacia_codigo))=r.code
   AND ${supplierCode("sp.origen_id")}=r.supplier
  LEFT JOIN farmetrica.proveedores_laboratorios m
   ON m.cliente_slug=$1 AND m.farmacia_id=r.pharmacy_id
   AND ${supplierCode("m.codigo_proveedor")}=r.supplier
  LEFT JOIN farmetrica.proveedores_maestro pm
   ON pm.cliente_slug=$1
    AND ${supplierCode("pm.codigo_origen")}=r.supplier
    AND ${normalizedLabSQL("pm.nombre")}=${normalizedLabSQL("sp.nombre")}
  WHERE NOT EXISTS (
   SELECT 1 FROM farmetrica.proveedores_maestro excluded
   WHERE excluded.cliente_slug=$1
    AND (excluded.cooperativa IS TRUE OR excluded.ignorar_informes IS TRUE
      OR excluded.tipo='cooperativa')
    AND ${supplierCode("excluded.codigo_origen")}=r.supplier
    AND ${normalizedLabSQL("excluded.nombre")}=${normalizedLabSQL("sp.nombre")})
    AND coalesce(pm.cooperativa,false) IS NOT TRUE
    AND coalesce(pm.ignorar_informes,false) IS NOT TRUE
    AND coalesce(pm.tipo,'')<>'cooperativa'
 ), receipt_evidence AS (
  SELECT 'N:'||${normalizedLabSQL("substring(lab_key from 3)")} AS key,
   substring(lab_key from 3) AS name,false AS medication,true AS parapharmacy
  FROM receipt_mappings WHERE lab_key LIKE 'N:%'
  UNION
  SELECT 'N:'||${normalizedLabSQL("n.laboratorio_titular")} AS key,
   n.laboratorio_titular AS name,true,true
  FROM receipt_mappings r
  JOIN farmetrica.nomenclator_presentaciones n
   ON r.lab_key='C:'||upper(btrim(coalesce(n.laboratorio_titular_codigo,'')))
  WHERE r.lab_key LIKE 'C:%'
  UNION
  SELECT 'N:'||${normalizedLabSQL("n.laboratorio_comercializador")},
   n.laboratorio_comercializador,true,true
  FROM receipt_mappings r
  JOIN farmetrica.nomenclator_presentaciones n
   ON r.lab_key='C:'||upper(btrim(coalesce(n.laboratorio_comercializador_codigo,'')))
  WHERE r.lab_key LIKE 'C:%'
 ), all_evidence AS (
  SELECT key,name,medication,parapharmacy FROM erp_evidence
  UNION ALL SELECT key,name,medication,parapharmacy FROM receipt_evidence
 )
 SELECT key,min(name) AS name,bool_or(medication) AS "hasMedication",
  bool_or(parapharmacy) AS "hasParapharmacy"
 FROM all_evidence WHERE key IS NOT NULL AND key<>'N:'
  AND name ~ '[[:alpha:]]{2}' AND name !~* '^[[:space:]]*[a-z]{0,4}[[:space:]-]*[0-9]{2,}'
 GROUP BY key`;
 const {rows}=await pool.query({text:sql,
  values:[context.client.slug,pharmacies],query_timeout:25000});
 return rows;
}
