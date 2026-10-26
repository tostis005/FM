-- Índices del preparador para calcular miles de CN en una única agregación.
-- Se ejecuta con psql, FUERA de una transacción: no bloquea escrituras ERP.
-- No modifica ventas, artículos ni documentos. Solo esquema real Ampedia.
\set ON_ERROR_STOP on
SET lock_timeout = '10s';
SET statement_timeout = '12min';

-- Retirar exclusivamente índices nuestros que estén inválidos; IF NOT EXISTS
-- no repararía índices abandonados tras una cancelación de CREATE CONCURRENTLY.
SELECT format('DROP INDEX CONCURRENTLY IF EXISTS %I.%I;',n.nspname,c.relname)
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
JOIN pg_index i ON i.indexrelid=c.oid
WHERE n.nspname='ampedia' AND c.relname IN (
 'fm_preparador_articulo_cn_idx','fm_preparador_articulo_origen_idx',
 'fm_preparador_articulo_normalizado_idx','fm_preparador_ventas_linea_idx')
 AND (NOT i.indisvalid OR NOT i.indisready)
\gexec

SELECT 'CREATE INDEX CONCURRENTLY IF NOT EXISTS fm_preparador_articulo_cn_idx
 ON ampedia.articulos ((upper(btrim(farmacia_codigo))),(btrim(codigo_nacional)))
 WHERE nullif(btrim(codigo_nacional),'''') IS NOT NULL;'
WHERE EXISTS (
 SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='ampedia' AND c.relname='articulos' AND c.relkind IN ('r','p'))
 AND EXISTS (
 SELECT 1 FROM information_schema.columns
 WHERE table_schema='ampedia' AND table_name='articulos' AND column_name='codigo_nacional')
\gexec

SELECT 'CREATE INDEX CONCURRENTLY IF NOT EXISTS fm_preparador_articulo_origen_idx
 ON ampedia.articulos ((upper(btrim(farmacia_codigo))),(origen_id::text));'
WHERE EXISTS (
 SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='ampedia' AND c.relname='articulos' AND c.relkind IN ('r','p'))
\gexec

SELECT 'CREATE INDEX CONCURRENTLY IF NOT EXISTS fm_preparador_articulo_normalizado_idx
 ON ampedia.articulos ((upper(btrim(farmacia_codigo))),(nullif(btrim(cn_normalizado),'''')))
 WHERE nullif(btrim(cn_normalizado),'''') IS NOT NULL;'
WHERE EXISTS (
 SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='ampedia' AND c.relname='articulos' AND c.relkind IN ('r','p'))
 AND EXISTS (
 SELECT 1 FROM information_schema.columns
 WHERE table_schema='ampedia' AND table_name='articulos' AND column_name='cn_normalizado')
\gexec

-- Índice por artículo para agrupar una sola vez todas las ventas de un CN.
-- Predicado idéntico al filtro de la vista fm_ventas_analitica.
SELECT 'CREATE INDEX CONCURRENTLY IF NOT EXISTS fm_preparador_ventas_linea_idx
 ON ampedia.fm_ventas_lineas (farmacia_codigo,articulo_origen_id,sistema_origen,documento_id)
 INCLUDE (cantidad,devuelta)
 WHERE NOT eliminada_logicamente AND coalesce(anulada,false)=false;'
WHERE EXISTS (
 SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='ampedia' AND c.relname='fm_ventas_lineas' AND c.relkind IN ('r','p'))
\gexec

-- Estadísticas para estimar correctamente cardinalidades tras crear índices.
SELECT 'ANALYZE ampedia.articulos;' WHERE EXISTS (
 SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='ampedia' AND c.relname='articulos' AND c.relkind IN ('r','p'))
\gexec
SELECT 'ANALYZE ampedia.fm_ventas_lineas;' WHERE EXISTS (
 SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='ampedia' AND c.relname='fm_ventas_lineas' AND c.relkind IN ('r','p'))
\gexec

SELECT c.relname AS index_name, i.indisvalid AS valid, i.indisready AS ready
FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='ampedia' AND c.relname IN (
 'fm_preparador_articulo_cn_idx','fm_preparador_articulo_origen_idx',
 'fm_preparador_articulo_normalizado_idx','fm_preparador_ventas_linea_idx')
ORDER BY c.relname;
