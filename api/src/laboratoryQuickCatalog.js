import {normalizedLabSQL} from "./laboratoryIdentity.js";
import {pharmacyDataCodeSQL} from "./pharmacyCodes.js";
import {retiredProductSQL} from "./laboratoryRetirements.js";

const validCN=e=>`CASE WHEN btrim(coalesce(${e}::text,'')) ~ '^[0-9]{6,7}$'
 THEN btrim(${e}::text) ELSE NULL::text END`;
const supplierCode=e=>`CASE WHEN btrim(${e}::text) ~ '^[0-9]+$'
 THEN coalesce(nullif(ltrim(btrim(${e}::text),'0'),''),'0')
 ELSE upper(btrim(${e}::text)) END`;
const officialMatch=alias=>`('N:'||${normalizedLabSQL(alias+".laboratorio_titular")}=$1
 OR 'N:'||${normalizedLabSQL(alias+".laboratorio_comercializador")}=$1
 OR 'N:'||${normalizedLabSQL(alias+".laboratorio")}=$1
 OR 'C:'||upper(btrim(coalesce(${alias}.laboratorio_titular_codigo,'')))=$1
 OR 'C:'||upper(btrim(coalesce(${alias}.laboratorio_comercializador_codigo,'')))=$1
 OR 'C:'||upper(btrim(coalesce(${alias}.laboratorio_codigo,'')))=$1)`;

async function readOfficial(pool,ctx,{key,pharmacies,search,page,size,patterns,hasNativeCN}){
 const schema='"'+ctx.client.schema+'"';
 const blockedCN=`coalesce(${validCN("a.codigo_nacional")},
  ${validCN(hasNativeCN?"a.cn_normalizado":"to_jsonb(a)->>'cn_normalizado'")},
  ${validCN("a.origen_id::text")})`;
 const sql=`
 WITH p AS (
  SELECT ${pharmacyDataCodeSQL("f")} AS code FROM farmetrica.farmacias f
  WHERE f.cliente_slug=$3 AND f.id=ANY($2::int[])
 ), blocked AS MATERIALIZED (
  SELECT DISTINCT ${blockedCN} AS cn FROM ${schema}.articulos a
  JOIN p ON upper(btrim(a.farmacia_codigo))=p.code
  WHERE ${retiredProductSQL("a.nombre","$7")}
 ), official AS (
  SELECT n.cn::text AS referencia,n.cn::text AS cn,n.nombre::text AS nombre,
   'medicacion'::text AS tipo,true AS "inMaster",
   false AS "inReceipts",false AS "inSales",false AS "inPurchases",
   NULL::text AS "pharmacyIds",n.dcpf,n.generico AS generic,false AS provisional
  FROM farmetrica.nomenclator_presentaciones n
  WHERE ${officialMatch("n")} AND NOT ${retiredProductSQL("n.nombre","$7")}
   AND ($4::text='' OR n.nombre ILIKE '%'||$4||'%' OR n.cn ILIKE '%'||$4||'%')
   AND NOT EXISTS(SELECT 1 FROM blocked b WHERE b.cn=n.cn)
 )
 SELECT *,count(*) OVER()::int AS total FROM official
 ORDER BY nombre,referencia LIMIT $5 OFFSET $6`;
 const {rows}=await pool.query({text:sql,
  values:[key,pharmacies,ctx.client.slug,search,size,(page-1)*size,patterns],
  query_timeout:15000});
 return {rows:rows.map(({total,...rest})=>rest),total:rows[0]?.total||0,page,size};
}

async function readPurchases(pool,ctx,{key,pharmacies,search,page,size,patterns,hasNativeCN}){
 const schema='"'+ctx.client.schema+'"';
 const cn=`coalesce(${validCN("a.codigo_nacional")},
  ${validCN(hasNativeCN?"a.cn_normalizado":"to_jsonb(a)->>'cn_normalizado'")},
  CASE WHEN EXISTS(SELECT 1 FROM farmetrica.nomenclator_presentaciones nn
   WHERE nn.cn=btrim(coalesce(a.origen_id::text,c.article_id)))
  THEN ${validCN("coalesce(a.origen_id::text,c.article_id)")} ELSE NULL::text END)`;
 const sql=`
 WITH pharmacies AS (
  SELECT f.id,${pharmacyDataCodeSQL("f")} AS code
  FROM farmetrica.farmacias f WHERE f.cliente_slug=$3 AND f.id=ANY($2::int[])
 ), lab_aliases AS MATERIALIZED (
  SELECT $1::text AS key
  UNION
  SELECT aliases.key FROM farmetrica.nomenclator_presentaciones n
  CROSS JOIN LATERAL (VALUES
   (${normalizedLabSQL("n.laboratorio_titular")},n.laboratorio_titular_codigo),
   (${normalizedLabSQL("n.laboratorio_comercializador")},n.laboratorio_comercializador_codigo)
  ) AS lab(name,code)
  CROSS JOIN LATERAL (VALUES ('N:'||lab.name),
   ('C:'||upper(btrim(coalesce(lab.code,''))))) AS aliases(key)
  WHERE ('N:'||lab.name=$1 OR 'C:'||upper(btrim(coalesce(lab.code,'')))=$1)
   AND aliases.key <> 'N:' AND aliases.key <> 'C:'
 ), links AS MATERIALIZED (
  SELECT p.id AS pharmacy_id,${supplierCode("sp.origen_id")} AS supplier_code
  FROM pharmacies p JOIN ${schema}.proveedores sp
   ON upper(btrim(sp.farmacia_codigo))=p.code
  WHERE 'N:'||${normalizedLabSQL("sp.nombre")} IN
    (SELECT key FROM lab_aliases WHERE key LIKE 'N:%')
   AND NOT EXISTS (SELECT 1 FROM farmetrica.proveedores_laboratorios m
    WHERE m.cliente_slug=$3 AND m.farmacia_id=p.id
     AND ${supplierCode("m.codigo_proveedor")}=${supplierCode("sp.origen_id")}
     AND m.laboratorio_clave NOT IN (SELECT key FROM lab_aliases))
   AND NOT EXISTS (SELECT 1 FROM farmetrica.proveedores_maestro pm
    WHERE pm.cliente_slug=$3 AND pm.cooperativa IS TRUE
     AND ${supplierCode("pm.codigo_origen")}=${supplierCode("sp.origen_id")}
     AND ${normalizedLabSQL("pm.nombre")}=${normalizedLabSQL("sp.nombre")})
  UNION
  SELECT m.farmacia_id,${supplierCode("m.codigo_proveedor")}
  FROM farmetrica.proveedores_laboratorios m
  JOIN pharmacies p ON p.id=m.farmacia_id
  WHERE m.cliente_slug=$3 AND m.laboratorio_clave IN (SELECT key FROM lab_aliases)
  UNION
  SELECT p.id,${supplierCode("pm.codigo_origen")}
  FROM farmetrica.proveedores_maestro pm
  JOIN pharmacies p ON true
  JOIN ${schema}.proveedores sp
   ON upper(btrim(sp.farmacia_codigo))=p.code
    AND ${supplierCode("sp.origen_id")}=${supplierCode("pm.codigo_origen")}
    AND ${normalizedLabSQL("sp.nombre")}=${normalizedLabSQL("pm.nombre")}
  WHERE pm.cliente_slug=$3 AND pm.cooperativa IS NOT TRUE
   AND pm.laboratorio_clave IN (SELECT key FROM lab_aliases)
   AND NOT EXISTS (SELECT 1 FROM farmetrica.proveedores_laboratorios m
    WHERE m.cliente_slug=$3 AND m.farmacia_id=p.id
     AND ${supplierCode("m.codigo_proveedor")}=${supplierCode("pm.codigo_origen")})
 ), purchased AS MATERIALIZED (
  SELECT DISTINCT p.id AS pharmacy_id,p.code,l.articulo_origen_id::text AS article_id
  FROM pharmacies p JOIN ${schema}.fm_recepciones_cabeceras h
   ON h.farmacia_codigo=p.code
  JOIN links k ON k.pharmacy_id=p.id
   AND k.supplier_code=${supplierCode("h.proveedor_origen_id")}
  JOIN ${schema}.fm_recepciones_lineas l
   ON l.farmacia_codigo=h.farmacia_codigo
    AND l.sistema_origen=h.sistema_origen AND l.documento_id=h.documento_id
  WHERE h.lineas_completas AND NOT h.eliminada_logicamente
   AND NOT l.eliminada_logicamente
   AND lower(btrim(h.estado)) NOT IN ('anulado','anulada','cancelado','cancelada','void')
   AND l.articulo_origen_id IS NOT NULL
 ), sales_lab AS MATERIALIZED (
  SELECT p.id AS pharmacy_id,p.code,a.origen_id::text AS article_id
  FROM pharmacies p JOIN ${schema}.articulos a
   ON upper(btrim(a.farmacia_codigo))=p.code
  WHERE 'N:'||${normalizedLabSQL("a.laboratorio")}=$1
   AND EXISTS(SELECT 1 FROM ${schema}.fm_ventas_analitica v
    WHERE v.farmacia_codigo=p.code AND v.articulo_id=a.origen_id::text)
 ), candidates AS MATERIALIZED (
  SELECT pharmacy_id,code,article_id FROM purchased
  UNION SELECT pharmacy_id,code,article_id FROM sales_lab
 ), activity AS (
  SELECT c.pharmacy_id,c.code,c.article_id,
   ${cn} AS cn,coalesce(nullif(btrim(a.nombre),''),n.nombre,c.article_id) AS nombre,
   CASE WHEN n.cn IS NOT NULL OR
     (${cn} ~ '^[0-9]{6,7}$' AND left(${cn},6)::int>=400000)
    THEN 'medicacion' ELSE 'parafarmacia' END AS tipo,
   EXISTS(SELECT 1 FROM ${schema}.fm_ventas_analitica v
    WHERE v.farmacia_codigo=c.code AND v.articulo_id=c.article_id) AS sold,
   EXISTS(SELECT 1 FROM purchased p2
    WHERE p2.pharmacy_id=c.pharmacy_id AND p2.article_id=c.article_id) AS bought,
   ${retiredProductSQL("a.nombre","$7")} AS inactive,
   (n.cn IS NULL OR ${officialMatch("n")}) AS valid_lab
  FROM candidates c
  LEFT JOIN ${schema}.articulos a
   ON upper(btrim(a.farmacia_codigo))=c.code AND a.origen_id::text=c.article_id
  LEFT JOIN farmetrica.nomenclator_presentaciones n ON n.cn=${cn}
 ), summarized AS (
  SELECT coalesce(cn,'ERP:'||pharmacy_id::text||':'||article_id) AS referencia,
   max(cn) AS cn,min(nombre) AS nombre,'parafarmacia'::text AS tipo,
   false AS "inMaster",bool_or(bought OR sold) AS "inReceipts",
   bool_or(sold) AS "inSales",bool_or(bought) AS "inPurchases",
   string_agg(DISTINCT pharmacy_id::text,',' ORDER BY pharmacy_id::text) AS "pharmacyIds",
   NULL::text AS dcpf,false AS generic,bool_and(cn IS NULL) AS provisional
  FROM activity WHERE tipo='parafarmacia' AND NOT inactive AND valid_lab
  GROUP BY coalesce(cn,'ERP:'||pharmacy_id::text||':'||article_id)
 ), filtered AS (
  SELECT * FROM summarized
  WHERE ($4::text='' OR nombre ILIKE '%'||$4||'%' OR referencia ILIKE '%'||$4||'%')
 )
 SELECT *,count(*) OVER()::int AS total FROM filtered
 ORDER BY nombre,referencia LIMIT $5 OFFSET $6`;
 const {rows}=await pool.query({text:sql,
  values:[key,pharmacies,ctx.client.slug,search,size,(page-1)*size,patterns],
  query_timeout:20000});
 return {rows:rows.map(({total,...rest})=>rest),total:rows[0]?.total||0,page,size};
}
export async function readQuickLaboratoryCatalog(pool,ctx,opts){
 if(opts.type==="medicacion")return readOfficial(pool,ctx,opts);
 if(opts.type==="parafarmacia")return readPurchases(pool,ctx,opts);
 return null;
}
