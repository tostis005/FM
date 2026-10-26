-- Reconciliar proveedores observados en Farmatic y en recepciones históricas.
-- Solo altas NO vinculadas. Nunca sobrescribe importaciones Excel ni enlaces manuales.
-- Se ejecuta después de 036 y del renombrado del esquema a ampedia.
BEGIN;
CREATE TEMP TABLE fm_suplentes_erp ON COMMIT DROP AS
WITH sources AS (
 SELECT upper(btrim(p.farmacia_codigo)) AS code,
  btrim(p.origen_id::text) AS source_code,
  min(nullif(btrim(p.nombre::text),'')) AS source_name, 0 AS priority
 FROM ampedia.proveedores p
 WHERE nullif(btrim(p.origen_id::text),'') IS NOT NULL
 GROUP BY 1,2
 UNION ALL
 SELECT upper(btrim(h.farmacia_codigo)),
  btrim(h.proveedor_origen_id::text),
  min(nullif(btrim(to_jsonb(h)->>'proveedor_nombre'),'')),1
 FROM ampedia.fm_recepciones_cabeceras h
 WHERE h.lineas_completas IS TRUE AND h.eliminada_logicamente IS NOT TRUE
  AND nullif(btrim(h.proveedor_origen_id::text),'') IS NOT NULL
 GROUP BY 1,2
), normalized AS (
 SELECT s.code,s.source_code,s.source_name,s.priority,
  CASE WHEN s.source_code ~ '^[0-9]+$'
   THEN coalesce(nullif(ltrim(s.source_code,'0'),''),'0')
   ELSE upper(s.source_code) END AS canon
 FROM sources s
 JOIN farmetrica.farmacias f ON f.cliente_slug='ampedia' AND
  (CASE WHEN f.id=5 AND upper(btrim(f.codigo_origen)) IN ('POL','VAL')
    THEN 'VAL' ELSE upper(btrim(f.codigo_origen)) END)=s.code
), chosen AS (
 SELECT DISTINCT ON (code,canon)
  code,source_code,source_name,canon
 FROM normalized ORDER BY code,canon,priority,
  (source_name IS NULL),source_code
)
SELECT * FROM chosen c WHERE NOT EXISTS (
 SELECT 1 FROM farmetrica.proveedores_unificados_alias a
 WHERE a.cliente_slug='ampedia' AND a.farmacia_codigo=c.code
  AND (CASE WHEN a.codigo_origen ~ '^[0-9]+$'
   THEN coalesce(nullif(ltrim(a.codigo_origen,'0'),''),'0')
   ELSE upper(btrim(a.codigo_origen)) END)=c.canon
);
INSERT INTO farmetrica.proveedores_unificados(cliente_slug,clave_unificada,nombre,clase)
SELECT 'ampedia','ERP:'||code||':'||canon,
 coalesce(source_name,'Proveedor '||source_code||' (nombre pendiente)'),'SIN_CLASIFICAR'
FROM fm_suplentes_erp
ON CONFLICT(cliente_slug,clave_unificada) DO NOTHING;
INSERT INTO farmetrica.proveedores_unificados_alias(
 cliente_slug,proveedor_id,farmacia_codigo,codigo_origen,
 nombre_origen,procedencia,vigencia
)
SELECT 'ampedia',p.id,s.code,s.source_code,
 coalesce(s.source_name,'Proveedor '||s.source_code||' (nombre pendiente)'),
 'farmatic','ACTUAL'
FROM fm_suplentes_erp s
JOIN farmetrica.proveedores_unificados p
 ON p.cliente_slug='ampedia' AND p.clave_unificada='ERP:'||s.code||':'||s.canon
ON CONFLICT(cliente_slug,farmacia_codigo,codigo_origen) DO NOTHING;
COMMIT;
