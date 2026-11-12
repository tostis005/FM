-- Una sola asignación por código nacional: solo almacén para parafarmacia.
-- Primero descartar mayoristas, cooperativas e ignorados; DESPUÉS ordenar recepciones.
-- Solo las referencias vistas en las farmacias solicitadas llegan al catálogo.
WITH eligible_labs AS MATERIALIZED (
 SELECT p.id,p.nombre
 FROM farmetrica.proveedores_unificados p
 WHERE p.cliente_slug=$1 AND p.activo
  AND p.clase IN ('DIRECTO','VACUNAS','FÓRMULAS')
  AND upper(p.nombre) !~ '(COOPERATIVA|COOP\\.?|MAYORISTA|DISTRIBUIDOR)'
  -- Los proveedores con nombre de farmacia no son laboratorios del pedido.
  AND upper(p.nombre) !~ '(^|[^A-Z])FARMACIAS?([^A-Z]|$)'
), pharmacies AS MATERIALIZED (
 SELECT f.id AS pharmacy_id,__PHARMACY_CODE__ AS pharmacy_code,
  (f.tipo_establecimiento='almacen') AS is_warehouse
 FROM farmetrica.farmacias f WHERE f.cliente_slug=$1
 UNION ALL
 -- AMP era el código del mismo almacén que ahora se llama ALMACEN.
 -- Conservar AMP en los JOIN contra documentos ERP; compartir únicamente el
 -- ID de establecimiento para el ámbito de catálogo y las bajas.
 SELECT f.id AS pharmacy_id,'AMP'::text AS pharmacy_code,
  true AS is_warehouse
 FROM farmetrica.farmacias f
 WHERE f.cliente_slug=$1 AND f.cliente_slug='ampedia' AND f.activo
  AND upper(btrim(f.codigo_origen))='ALMACEN'
  AND f.tipo_establecimiento='almacen'
), alias_candidates AS MATERIALIZED (
 SELECT f.pharmacy_id,upper(btrim(a.farmacia_codigo)) AS pharmacy_code,p.id AS lab_id,
  CASE WHEN btrim(a.codigo_origen)~'^[0-9]+$'
    THEN coalesce(nullif(ltrim(btrim(a.codigo_origen),'0'),''),'0')
    ELSE upper(btrim(a.codigo_origen)) END AS supplier_code,
  a.codigo_origen,a.nombre_origen,a.vigencia,a.procedencia,a.actualizado_en,p.nombre AS lab_name
 FROM eligible_labs p
 JOIN farmetrica.proveedores_unificados_alias a
  ON a.cliente_slug=$1 AND a.proveedor_id=p.id
 LEFT JOIN pharmacies f ON f.pharmacy_code=upper(btrim(a.farmacia_codigo))
), eligible_aliases AS MATERIALIZED (
 SELECT c.* FROM alias_candidates c
 WHERE NOT EXISTS (
  SELECT 1 FROM farmetrica.proveedores_maestro pm
  WHERE pm.cliente_slug=$1
   AND (pm.cooperativa IS TRUE OR pm.ignorar_informes IS TRUE OR pm.tipo='cooperativa')
   AND (CASE WHEN btrim(pm.codigo_origen)~'^[0-9]+$'
    THEN coalesce(nullif(ltrim(btrim(pm.codigo_origen),'0'),''),'0')
    ELSE upper(btrim(pm.codigo_origen)) END)=c.supplier_code
   AND (
    upper(btrim(pm.nombre))=upper(btrim(c.nombre_origen))
    OR upper(btrim(pm.nombre))=upper(btrim(c.lab_name))
    OR EXISTS(SELECT 1 FROM __SCHEMA__.proveedores sp
      WHERE upper(btrim(sp.farmacia_codigo))=c.pharmacy_code
       AND (CASE WHEN btrim(sp.origen_id)~'^[0-9]+$'
         THEN coalesce(nullif(ltrim(btrim(sp.origen_id),'0'),''),'0')
         ELSE upper(btrim(sp.origen_id)) END)=c.supplier_code
       AND upper(btrim(sp.nombre))=upper(btrim(pm.nombre)))
   )
 )
),
supplier_links AS MATERIALIZED (
 -- La identidad del proveedor se confirma por código de farmacia y código
 -- de origen, también cuando la farmacia histórica ya no está activa.
 -- Una colisión con laboratorios distintos queda sin clasificar.
 SELECT min(pharmacy_id) AS pharmacy_id,pharmacy_code,supplier_code,
  min(lab_id) AS lab_id
 FROM eligible_aliases
 GROUP BY pharmacy_code,supplier_code
 HAVING count(DISTINCT lab_id)=1
), received AS MATERIALIZED (
 SELECT k.lab_id,k.pharmacy_id,k.pharmacy_code,h.fecha,
  h.sistema_origen,h.documento_id,l.linea_id,
  coalesce(
   CASE WHEN btrim(ar.codigo_nacional) ~ '^[0-9]{6,7}$'
    THEN btrim(ar.codigo_nacional) END,
   CASE WHEN btrim(to_jsonb(ar)->>'cn_normalizado') ~ '^[0-9]{6,7}$'
    THEN btrim(to_jsonb(ar)->>'cn_normalizado') END,
   CASE WHEN btrim(ar.origen_id::text) ~ '^[0-9]{6,7}$'
    THEN btrim(ar.origen_id::text) END
  ) AS cn,coalesce(nullif(btrim(ar.nombre),''),l.articulo_origen_id) AS nombre
 FROM supplier_links k
 JOIN __SCHEMA__.fm_recepciones_cabeceras h
  ON h.farmacia_codigo=k.pharmacy_code
   -- Misma expresión que fm_preparador_recepciones_proveedor_idx:
   -- PostgreSQL puede acceder al índice por farmacia y proveedor, sin recorrer
   -- las cabeceras completas del histórico para cada consulta del preparador.
   AND (CASE WHEN btrim(coalesce(h.proveedor_origen_id::text,'')) ~ '^[0-9]+$'
    THEN coalesce(nullif(ltrim(btrim(h.proveedor_origen_id::text),'0'),''),'0')
    ELSE upper(btrim(coalesce(h.proveedor_origen_id::text,''))) END)=k.supplier_code
  AND h.lineas_completas AND NOT h.eliminada_logicamente
  AND lower(btrim(h.estado)) NOT IN ('anulado','anulada','cancelado','cancelada','void')
 JOIN __SCHEMA__.fm_recepciones_lineas l
  ON l.farmacia_codigo=h.farmacia_codigo
   AND l.sistema_origen=h.sistema_origen AND l.documento_id=h.documento_id
  AND NOT l.eliminada_logicamente AND l.cantidad>0 AND l.devuelta IS NOT TRUE
 LEFT JOIN __SCHEMA__.articulos ar
  ON upper(btrim(ar.farmacia_codigo))=k.pharmacy_code
   AND ar.origen_id::text=l.articulo_origen_id::text
),
received_with_cn AS MATERIALIZED (
 -- Parafarmacia: usar EXCLUSIVAMENTE las recepciones del almacén
 -- (ALMACEN y su código histórico AMP). Una recepción de una farmacia
 -- nunca determina el laboratorio de un artículo de parafarmacia.
 -- Medicación conserva la regla anterior sin restringir farmacias.
 SELECT r.* FROM received r
 WHERE r.cn IS NOT NULL AND (
  left(r.cn,6)::integer >= 400000
  OR EXISTS (
   SELECT 1 FROM pharmacies p
   WHERE p.pharmacy_code=r.pharmacy_code
    AND p.is_warehouse IS TRUE
  )
 )
), excluded_cn AS MATERIALIZED (
 -- Solo las reglas configuradas por el usuario se evalúan literalmente.
 SELECT DISTINCT coalesce(
   CASE WHEN btrim(ar.codigo_nacional) ~ '^[0-9]{6,7}$'
     THEN btrim(ar.codigo_nacional) END,
   CASE WHEN btrim(to_jsonb(ar)->>'cn_normalizado') ~ '^[0-9]{6,7}$'
     THEN btrim(to_jsonb(ar)->>'cn_normalizado') END,
   CASE WHEN btrim(ar.origen_id::text) ~ '^[0-9]{6,7}$'
     THEN btrim(ar.origen_id::text) END
 ) AS cn
 FROM __SCHEMA__.articulos ar
 JOIN pharmacies p ON upper(btrim(ar.farmacia_codigo))=p.pharmacy_code
 WHERE p.pharmacy_id=ANY($2::int[])
  AND EXISTS (SELECT 1 FROM unnest(
    $3::text[]
   ) AS exclude(cadena)
   WHERE position(upper(exclude.cadena) in upper(coalesce(ar.nombre,'')))>0)
), scoped_cn AS MATERIALIZED (
 -- El laboratorio se determina desde el almacén para parafarmacia;
 -- para medicación sigue valiendo la última recepción de cualquier farmacia. El ámbito visible se determina por
 -- el catálogo del propio artículo en las farmacias actuales autorizadas.
 SELECT cn FROM (
  SELECT cn FROM received_with_cn
  WHERE pharmacy_id=ANY($2::int[])
   OR ($1='ampedia' AND pharmacy_code IN ('AMP','ALMACEN'))
  UNION
  SELECT coalesce(
   CASE WHEN btrim(coalesce(ar.codigo_nacional,'')) ~ '^[0-9]{6,7}$'
    THEN btrim(ar.codigo_nacional) END,
   CASE WHEN btrim(coalesce(to_jsonb(ar)->>'cn_normalizado','')) ~ '^[0-9]{6,7}$'
    THEN btrim(to_jsonb(ar)->>'cn_normalizado') END,
   CASE WHEN btrim(ar.origen_id::text) ~ '^[0-9]{6,7}$'
    THEN btrim(ar.origen_id::text) END
  ) AS cn
  FROM __SCHEMA__.articulos ar
  JOIN pharmacies f ON upper(btrim(ar.farmacia_codigo))=f.pharmacy_code
  WHERE f.pharmacy_id=ANY($2::int[])
 ) observed
 WHERE cn IN (SELECT cn FROM received_with_cn)
), latest AS MATERIALIZED (
 SELECT DISTINCT ON (cn) cn,lab_id,nombre
 FROM received_with_cn
 ORDER BY cn,fecha DESC,pharmacy_code,sistema_origen,documento_id,linea_id
)
SELECT l.lab_id::text AS lab_id,l.cn,l.nombre,
 (EXISTS(SELECT 1 FROM excluded_cn b WHERE b.cn=l.cn)
  OR EXISTS (SELECT 1 FROM unnest(
    $3::text[]
   ) AS exclude(cadena)
   WHERE position(upper(exclude.cadena) in upper(coalesce(l.nombre,'')))>0)
 ) AS excluded
FROM latest l JOIN scoped_cn s USING(cn)
ORDER BY l.lab_id,l.cn;
