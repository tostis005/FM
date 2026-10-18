\set ON_ERROR_STOP on
\pset pager off
\echo === Farmacias configuradas (identificador, código, estado) ===
SELECT id,nombre,codigo_origen,activo FROM farmetrica.farmacias
 WHERE cliente_slug='ampedia' ORDER BY id;
\echo === Códigos observados por tabla y conciliación con el maestro ===
WITH origin AS (
 SELECT 'ventas' AS tabla,upper(btrim(farmacia_codigo)) AS codigo,count(*)::bigint AS filas,
   min(fecha)::date AS primera,max(fecha)::date AS ultima FROM ampedia.ventas
   GROUP BY 2
 UNION ALL
 SELECT 'compras',upper(btrim(farmacia_codigo)),count(*),
   min(fecha)::date,max(fecha)::date FROM ampedia.compras GROUP BY 2
 UNION ALL
 SELECT 'articulos',upper(btrim(farmacia_codigo)),count(*),
   NULL::date,NULL::date FROM ampedia.articulos GROUP BY 2
 UNION ALL
 SELECT 'proveedores',upper(btrim(farmacia_codigo)),count(*),
   NULL::date,NULL::date FROM ampedia.proveedores GROUP BY 2
)
SELECT o.tabla,quote_nullable(o.codigo) AS codigo_origen,coalesce(f.id::text,'SIN_MAPEO') AS farmacia_id,
   coalesce(f.nombre,'SIN_MAPEO') AS farmacia_nombre,o.filas,o.primera,o.ultima
FROM origin o
LEFT JOIN farmetrica.farmacias f ON f.cliente_slug='ampedia'
 AND upper(btrim(f.codigo_origen))=o.codigo
ORDER BY o.tabla,f.id NULLS LAST,o.codigo;
\echo === Farmacias sin movimientos que coincidan por código ===
WITH codes AS (
 SELECT 'ventas' AS tabla,upper(btrim(farmacia_codigo)) AS code FROM ampedia.ventas GROUP BY 2
 UNION ALL SELECT 'compras',upper(btrim(farmacia_codigo)) FROM ampedia.compras GROUP BY 2
 UNION ALL SELECT 'articulos',upper(btrim(farmacia_codigo)) FROM ampedia.articulos GROUP BY 2
 UNION ALL SELECT 'proveedores',upper(btrim(farmacia_codigo)) FROM ampedia.proveedores GROUP BY 2
)
SELECT f.id,f.nombre,f.codigo_origen,
  EXISTS(SELECT 1 FROM codes c WHERE c.tabla='ventas' AND c.code=upper(btrim(f.codigo_origen))) AS ventas,
  EXISTS(SELECT 1 FROM codes c WHERE c.tabla='compras' AND c.code=upper(btrim(f.codigo_origen))) AS compras,
  EXISTS(SELECT 1 FROM codes c WHERE c.tabla='articulos' AND c.code=upper(btrim(f.codigo_origen))) AS articulos,
  EXISTS(SELECT 1 FROM codes c WHERE c.tabla='proveedores' AND c.code=upper(btrim(f.codigo_origen))) AS proveedores
FROM farmetrica.farmacias f WHERE f.cliente_slug='ampedia' ORDER BY f.id;
\echo === Índices existentes y tamaños estimados ===
SELECT schemaname,tablename,indexname,indexdef
FROM pg_indexes WHERE schemaname IN ('ampedia','farmetrica')
 AND tablename IN ('ventas','compras','articulos','proveedores','farmacias')
ORDER BY schemaname,tablename,indexname;
SELECT n.nspname AS esquema,c.relname AS tabla,c.reltuples::bigint AS filas_estimadas,
 pg_size_pretty(pg_total_relation_size(c.oid)) AS tam_total,
 pg_size_pretty(pg_indexes_size(c.oid)) AS tam_indices
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='ampedia' AND c.relkind='r' AND
 c.relname IN ('ventas','compras','articulos','proveedores')
ORDER BY c.relname;
