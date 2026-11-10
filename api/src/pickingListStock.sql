-- Matriz de existencias: el SKU Shopify de hasta 7 cifras se normaliza
-- como CN (mínimo 6 cifras, como en el Power BI original).
-- NULL cuando un origen no tiene importación de artículos aún.
WITH sources AS MATERIALIZED (
 SELECT f.id::text AS site_id,f.nombre AS site_name,
   __PHARMACY_CODE__ AS source_code,
   CASE WHEN upper(btrim(f.codigo_origen))='ALMACEN' THEN 'almacen'
        ELSE 'farmacia' END AS kind
 FROM farmetrica.farmacias f
 WHERE f.cliente_slug=$1 AND f.activo
   AND (coalesce(to_jsonb(f)->>'tipo_establecimiento','farmacia')='farmacia'
        OR upper(btrim(f.codigo_origen))='ALMACEN')
), sites AS MATERIALIZED (
 SELECT s.*,
  EXISTS (SELECT 1 FROM __SCHEMA__.articulos a
   WHERE upper(btrim(a.farmacia_codigo))=s.source_code LIMIT 1) AS ready
 FROM sources s
), codes AS MATERIALIZED (
 SELECT DISTINCT value AS cn FROM jsonb_array_elements_text($2::jsonb)
), candidates AS (
 SELECT s.site_id,c.cn,a.origen_id::text AS article_id,
  a.stock_actual::float8 AS stock,a.nombre,a.sincronizado_en AS stock_at
 FROM sites s CROSS JOIN codes c JOIN __SCHEMA__.articulos a
  ON upper(btrim(a.farmacia_codigo))=s.source_code
   AND btrim(a.codigo_nacional)=c.cn
 UNION ALL
 SELECT s.site_id,c.cn,a.origen_id::text AS article_id,
  a.stock_actual::float8 AS stock,a.nombre,a.sincronizado_en AS stock_at
 FROM sites s CROSS JOIN codes c JOIN __SCHEMA__.articulos a
  ON upper(btrim(a.farmacia_codigo))=s.source_code
   AND a.origen_id::text=c.cn
 WHERE nullif(btrim(a.codigo_nacional),'') IS NULL
), unique_articles AS (
 SELECT DISTINCT ON (site_id,cn,article_id)
  site_id,cn,article_id,stock,nombre,stock_at
 FROM candidates ORDER BY site_id,cn,article_id,stock_at DESC NULLS LAST
), inventory AS (
 SELECT site_id,cn,
  CASE WHEN count(stock)=count(*) THEN sum(stock)::float8 ELSE NULL::float8 END AS stock,
  max(nombre) AS name,min(stock_at) AS stock_at
 FROM unique_articles GROUP BY site_id,cn
)
SELECT s.site_id AS "siteId",s.site_name AS "siteName",
 s.source_code AS code,s.kind,s.ready,
 c.cn,i.stock,i.name,i.stock_at AS "stockAt",
 (i.cn IS NOT NULL) AS matched
FROM sites s LEFT JOIN codes c ON true
 LEFT JOIN inventory i ON i.site_id=s.site_id AND i.cn=c.cn
ORDER BY CASE WHEN s.kind='almacen' THEN 0 ELSE 1 END,s.site_id,c.cn;
