-- Una sola asignación por código nacional entre todas las farmacias del cliente.
-- Primero descartar mayoristas, cooperativas e ignorados; DESPUÉS ordenar recepciones.
-- Solo las referencias vistas en las farmacias solicitadas llegan al catálogo.
WITH eligible_labs AS MATERIALIZED (
 SELECT p.id,p.nombre
 FROM farmetrica.proveedores_unificados p
 WHERE p.cliente_slug=$1 AND p.activo
  AND p.clase IN ('DIRECTO','VACUNAS','FÓRMULAS')
  AND upper(p.nombre) !~ '(COOPERATIVA|COOP\\.?|MAYORISTA|DISTRIBUIDOR)'
), pharmacies AS MATERIALIZED (
 SELECT f.id AS pharmacy_id,__PHARMACY_CODE__ AS pharmacy_code
 FROM farmetrica.farmacias f WHERE f.cliente_slug=$1
), alias_candidates AS MATERIALIZED (
 SELECT f.pharmacy_id,f.pharmacy_code,p.id AS lab_id,
  CASE WHEN btrim(a.codigo_origen)~'^[0-9]+$'
    THEN coalesce(nullif(ltrim(btrim(a.codigo_origen),'0'),''),'0')
    ELSE upper(btrim(a.codigo_origen)) END AS supplier_code,
  a.codigo_origen,a.nombre_origen,a.vigencia,a.procedencia,a.actualizado_en,p.nombre AS lab_name
 FROM eligible_labs p
 JOIN farmetrica.proveedores_unificados_alias a
  ON a.cliente_slug=$1 AND a.proveedor_id=p.id
 JOIN pharmacies f ON f.pharmacy_code=upper(btrim(a.farmacia_codigo))
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
 -- En Farmatic un código de proveedor solo tiene significado dentro de su farmacia.
 -- Ante un alias duplicado tras quitar ceros se utiliza una elección estable.
 SELECT DISTINCT ON (pharmacy_id,supplier_code)
  pharmacy_id,pharmacy_code,supplier_code,lab_id
 FROM eligible_aliases
 ORDER BY pharmacy_id,supplier_code,
  (vigencia='ACTUAL') DESC,(procedencia='manual') DESC,
  actualizado_en DESC,lab_id
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
   AND (CASE WHEN btrim(h.proveedor_origen_id)~'^[0-9]+$'
    THEN coalesce(nullif(ltrim(btrim(h.proveedor_origen_id),'0'),''),'0')
    ELSE upper(btrim(h.proveedor_origen_id)) END)=k.supplier_code
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
 SELECT * FROM received WHERE cn IS NOT NULL
), scoped_cn AS MATERIALIZED (
 SELECT DISTINCT cn FROM received_with_cn WHERE pharmacy_id=ANY($2::int[])
), latest AS MATERIALIZED (
 SELECT DISTINCT ON (cn) cn,lab_id,nombre
 FROM received_with_cn
 ORDER BY cn,fecha DESC,pharmacy_code,sistema_origen,documento_id,linea_id
)
SELECT l.lab_id::text AS lab_id,l.cn,l.nombre
FROM latest l JOIN scoped_cn s USING(cn)
ORDER BY l.lab_id,l.cn;
