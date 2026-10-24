import {normalizedLabSQL} from "./laboratoryIdentity.js";
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";

const SCHEMA=/^[a-z][a-z0-9_]{1,62}$/;
const supplierCodeSQL=expr=>`CASE WHEN btrim(${expr}::text) ~ '^[0-9]+$'
 THEN coalesce(nullif(ltrim(btrim(${expr}::text),'0'),''),'0')
 ELSE upper(btrim(${expr}::text)) END`;

const safeReference=expr=>`CASE WHEN btrim(${expr}) ~ '^[0-9]{6,7}$' THEN btrim(${expr})
 WHEN btrim(${expr}) ~ '^[0-9]{13}$' THEN btrim(${expr}) ELSE NULL END`;
const referenceKind=expr=>`CASE WHEN ${expr} ~ '^[0-9]{6,7}$'
 THEN CASE WHEN left(${expr},6)::int < 400000 THEN 'parafarmacia' ELSE 'medicacion' END
 WHEN ${expr} ~ '^[0-9]{13}$' THEN 'parafarmacia'
 ELSE 'parafarmacia' END`;

/**
 * Independent from sales, receipts, pending orders and inventory tables.
 * Source-only catalog stays visible if metric calculations are unavailable.
 */
export async function readDirectLaboratoryCatalog(pool,context,{key,pharmacies,type,search="",page=1,size=40}){
 if(!SCHEMA.test(context.client.schema))throw Error("Esquema no autorizado");
 const schema='"'+context.client.schema+'"';
 const nname=normalizedLabSQL("n.laboratorio");
 const titular=normalizedLabSQL("n.laboratorio_titular");
 const commercial=normalizedLabSQL("n.laboratorio_comercializador");
 const manual=normalizedLabSQL("m.laboratorio_nombre");
 const mkey=normalizedLabSQL("substring(m.laboratorio_clave from 3)");
 const artLab=normalizedLabSQL("a.laboratorio");
 const ecode=safeReference("a.codigo_nacional");
 const eType=referenceKind(ecode);
 const sql=`
 WITH aliases AS (
  SELECT $1::text AS key
  UNION SELECT 'C:'||upper(btrim(n.laboratorio_titular_codigo))
  FROM farmetrica.nomenclator_presentaciones n
  WHERE 'N:'||${titular}=$1 AND nullif(btrim(n.laboratorio_titular_codigo),'') IS NOT NULL
  UNION SELECT 'C:'||upper(btrim(n.laboratorio_comercializador_codigo))
  FROM farmetrica.nomenclator_presentaciones n
  WHERE 'N:'||${commercial}=$1 AND nullif(btrim(n.laboratorio_comercializador_codigo),'') IS NOT NULL
 ),
 scoped_pharmacies AS (
  SELECT f.id,${pharmacyDataCodeSQL("f")} AS code FROM farmetrica.farmacias f
  WHERE f.cliente_slug=$3 AND f.id=ANY($2::int[])
 ),
 supplier_links AS (
  SELECT m.farmacia_id,${supplierCodeSQL("m.codigo_proveedor")} AS supplier_code,
   m.laboratorio_clave AS laboratory_key
  FROM farmetrica.proveedores_laboratorios m
  JOIN scoped_pharmacies p ON p.id=m.farmacia_id
  WHERE m.cliente_slug=$3 AND NOT EXISTS (
   SELECT 1 FROM farmetrica.proveedores_maestro pm
   WHERE pm.cliente_slug=$3 AND pm.cooperativa=true
    AND ${supplierCodeSQL("pm.codigo_origen")}=${supplierCodeSQL("m.codigo_proveedor")}
  )
  UNION ALL
  SELECT p.id,${supplierCodeSQL("pm.codigo_origen")},pm.laboratorio_clave
  FROM farmetrica.proveedores_maestro pm
  CROSS JOIN scoped_pharmacies p
  WHERE pm.cliente_slug=$3 AND pm.laboratorio_clave IS NOT NULL
   AND pm.cooperativa IS NOT TRUE
   AND NOT EXISTS (
    SELECT 1 FROM farmetrica.proveedores_laboratorios m
    WHERE m.cliente_slug=$3 AND m.farmacia_id=p.id
     AND ${supplierCodeSQL("m.codigo_proveedor")}=${supplierCodeSQL("pm.codigo_origen")}
   )
 ),
 mapped_suppliers AS (
  SELECT DISTINCT s.farmacia_id,s.supplier_code FROM supplier_links s
  WHERE s.laboratory_key IN (SELECT key FROM aliases)
   OR (s.laboratory_key LIKE 'N:%'
    AND 'N:'||${normalizedLabSQL("substring(s.laboratory_key from 3)")}=$1)
 ),
 source AS (
  SELECT n.cn::text AS referencia,n.cn::text AS cn,n.nombre::text AS nombre,
   'medicacion'::text AS tipo,true AS from_master,false AS from_erp,NULL::text AS pharmacy_id,2 AS preference
  FROM farmetrica.nomenclator_presentaciones n
  WHERE ('N:'||${commercial}=$1 OR 'N:'||${titular}=$1 OR 'N:'||${nname}=$1)
  UNION ALL
  SELECT m.codigo::text,m.codigo::text,m.nombre::text,m.tipo::text,
    true,false,NULL::text,CASE WHEN m.fuente='vademecum' THEN 1 ELSE 2 END
  FROM farmetrica.articulos_laboratorio_maestro m
  WHERE ('N:'||${manual}=$1 OR
    (m.laboratorio_clave LIKE 'N:%' AND 'N:'||${mkey}=$1) OR m.laboratorio_clave=$1)
  UNION ALL
  SELECT coalesce(${ecode},'ERP:'||f.id::text||':'||a.origen_id::text),
   ${ecode},coalesce(nullif(btrim(a.nombre),''),a.origen_id::text),
   ${eType},false,true,f.id::text,3
  FROM ${schema}.articulos a
  JOIN farmetrica.farmacias f ON f.cliente_slug=$3 AND f.id=ANY($2::int[])
   AND upper(btrim(a.farmacia_codigo))=${pharmacyDataCodeSQL("f")}
  WHERE 'N:'||${artLab}=$1 AND nullif(btrim(a.origen_id::text),'') IS NOT NULL
 UNION ALL
 SELECT coalesce(${ecode},'ERP:'||f.id::text||':'||a.origen_id::text),
  ${ecode},coalesce(nullif(btrim(a.nombre),''),a.origen_id::text),
  ${eType},false,true,f.id::text,3
 FROM mapped_suppliers link
 JOIN farmetrica.farmacias f ON f.cliente_slug=$3 AND f.id=link.farmacia_id
 JOIN ${schema}.fm_recepciones_analitica r
  ON upper(btrim(r.farmacia_codigo))=${pharmacyDataCodeSQL("f")}
   AND ${supplierCodeSQL("r.proveedor_id")}=link.supplier_code
 JOIN ${schema}.articulos a
  ON upper(btrim(a.farmacia_codigo))=${pharmacyDataCodeSQL("f")}
   AND a.origen_id::text=r.articulo_id::text
 WHERE nullif(btrim(a.origen_id::text),'') IS NOT NULL
 ),
 reduced AS (
  SELECT referencia, max(cn) AS cn,
    coalesce(min(nombre) FILTER(WHERE preference=1),
      min(nombre) FILTER(WHERE preference=2),min(nombre)) AS nombre,
    CASE WHEN max(cn) ~ '^[0-9]{6,7}$'
     THEN CASE WHEN left(max(cn),6)::int<400000 THEN 'parafarmacia' ELSE 'medicacion' END
     WHEN max(cn) ~ '^[0-9]{13}$' THEN 'parafarmacia'
     WHEN bool_or(tipo='medicacion') THEN 'medicacion' ELSE 'parafarmacia' END AS tipo,
    bool_or(from_master) AS "inMaster",
    bool_or(from_erp) AS "inReceipts",
    string_agg(DISTINCT pharmacy_id,',' ORDER BY pharmacy_id) FILTER(WHERE pharmacy_id IS NOT NULL) AS "pharmacyIds"
  FROM source WHERE referencia IS NOT NULL GROUP BY referencia
 ),
 filtered AS (
  SELECT *,("inReceipts"=true AND "inMaster"=false AND cn IS NULL) AS provisional
  FROM reduced WHERE tipo=$4 AND
   ($5::text='' OR nombre ILIKE '%'||$5||'%' OR referencia ILIKE '%'||$5||'%')
 )
 SELECT *,count(*) OVER()::int AS total
 FROM filtered ORDER BY nombre,referencia LIMIT $6 OFFSET $7`;
 const {rows}=await pool.query({text:sql,
  values:[key,pharmacies,context.client.slug,type,search,size,(page-1)*size],
  query_timeout:20000});
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
