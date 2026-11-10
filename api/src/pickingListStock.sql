-- Picking List: SKU de hasta 7 dígitos se cruza por CN, y un
-- EAN Shopify de 8-14 dígitos por EAN del artículo sincronizado.
-- No atribuir origen_id ERP de una farmacia a otra diferente.
WITH sources AS MATERIALIZED (
 SELECT f.id::text AS site_id,f.nombre AS site_name,
   __PHARMACY_CODE__ AS source_code,
   CASE WHEN upper(btrim(f.codigo_origen))='ALMACEN' THEN 'almacen'
        ELSE 'farmacia' END AS kind
 FROM farmetrica.farmacias f
 WHERE f.cliente_slug=$1 AND f.activo
   AND upper(btrim(f.codigo_origen))<>'AMP'
   AND (f.id=ANY($3::int[]) OR upper(btrim(f.codigo_origen))='ALMACEN')
   AND (coalesce(to_jsonb(f)->>'tipo_establecimiento','farmacia')='farmacia'
        OR upper(btrim(f.codigo_origen))='ALMACEN')
), sites AS MATERIALIZED (
 SELECT s.*,
  EXISTS (SELECT 1 FROM __SCHEMA__.articulos a
   WHERE upper(btrim(a.farmacia_codigo))=s.source_code LIMIT 1) AS ready
 FROM sources s
), codes AS MATERIALIZED (
 SELECT DISTINCT r.key,r.cn,r.sku
 FROM jsonb_to_recordset($2::jsonb) AS r(key text,cn text,sku text)
), candidates AS (
 SELECT s.site_id,c.key,a.origen_id::text AS article_id,
  a.stock_actual::float8 AS stock,a.nombre,a.sincronizado_en AS stock_at
 FROM sites s CROSS JOIN codes c JOIN __SCHEMA__.articulos a
  ON upper(btrim(a.farmacia_codigo))=s.source_code
   AND btrim(a.codigo_nacional)=c.cn
 WHERE c.cn IS NOT NULL
 UNION ALL
 SELECT s.site_id,c.key,a.origen_id::text AS article_id,
  a.stock_actual::float8 AS stock,a.nombre,a.sincronizado_en AS stock_at
 FROM sites s CROSS JOIN codes c JOIN __SCHEMA__.articulos a
  ON upper(btrim(a.farmacia_codigo))=s.source_code
   AND a.origen_id::text=c.cn
 WHERE c.cn IS NOT NULL AND nullif(btrim(a.codigo_nacional),'') IS NULL
 UNION ALL
 SELECT s.site_id,c.key,a.origen_id::text AS article_id,
  a.stock_actual::float8 AS stock,a.nombre,a.sincronizado_en AS stock_at
 FROM sites s CROSS JOIN codes c JOIN __SCHEMA__.articulos a
  ON upper(btrim(a.farmacia_codigo))=s.source_code
   AND btrim(coalesce(to_jsonb(a)->>'ean',''))=c.sku
 WHERE c.cn IS NULL AND c.sku ~ '^[0-9]{8,14}
 SELECT DISTINCT ON (site_id,key,article_id)
  site_id,key,article_id,stock,nombre,stock_at
 FROM candidates ORDER BY site_id,key,article_id,stock_at DESC NULLS LAST
), inventory AS (
 SELECT site_id,key,
  CASE WHEN count(stock)=count(*) THEN sum(stock)::float8 ELSE NULL::float8 END AS stock,
  max(nombre) AS name,min(stock_at) AS stock_at
 FROM unique_articles GROUP BY site_id,key
)
SELECT s.site_id AS "siteId",s.site_name AS "siteName",
 s.source_code AS code,s.kind,s.ready,
 c.key,i.stock,i.name,i.stock_at AS "stockAt",
 (i.key IS NOT NULL) AS matched
FROM sites s LEFT JOIN codes c ON true
 LEFT JOIN inventory i ON i.site_id=s.site_id AND i.key=c.key
ORDER BY CASE WHEN s.kind='almacen' THEN 0 ELSE 1 END,s.site_id,c.key;

 __SYNONYM_EAN_MATCH__
), unique_articles AS (
 SELECT DISTINCT ON (site_id,key,article_id)
  site_id,key,article_id,stock,nombre,stock_at
 FROM candidates ORDER BY site_id,key,article_id,stock_at DESC NULLS LAST
), inventory AS (
 SELECT site_id,key,
  CASE WHEN count(stock)=count(*) THEN sum(stock)::float8 ELSE NULL::float8 END AS stock,
  max(nombre) AS name,min(stock_at) AS stock_at
 FROM unique_articles GROUP BY site_id,key
)
SELECT s.site_id AS "siteId",s.site_name AS "siteName",
 s.source_code AS code,s.kind,s.ready,
 c.key,i.stock,i.name,i.stock_at AS "stockAt",
 (i.key IS NOT NULL) AS matched
FROM sites s LEFT JOIN codes c ON true
 LEFT JOIN inventory i ON i.site_id=s.site_id AND i.key=c.key
ORDER BY CASE WHEN s.kind='almacen' THEN 0 ELSE 1 END,s.site_id,c.key;
