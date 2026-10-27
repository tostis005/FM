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
