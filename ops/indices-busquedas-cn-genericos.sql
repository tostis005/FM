-- Búsquedas de CN, nombre y desgloses DCPF sobre orígenes definitivos.
-- Ejecutar con psql -X -v ON_ERROR_STOP=1 FUERA DE TRANSACCIÓN.
-- No modifica datos; índices concurrentes para no detener el sincronizador.
\set ON_ERROR_STOP on
SET lock_timeout='12s';
SET statement_timeout='65min';
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Limpieza de índices NUEVOS inválidos por deadlock/cancelación.
SELECT format('DROP INDEX CONCURRENTLY IF EXISTS %I.%I;',ns.nspname,idx.relname)
FROM pg_class idx JOIN pg_namespace ns ON ns.oid=idx.relnamespace
JOIN pg_index ix ON ix.indexrelid=idx.oid
WHERE (ns.nspname='farmetrica' OR ns.nspname IN
  (SELECT DISTINCT esquema_datos FROM farmetrica.clientes))
 AND idx.relname=ANY(ARRAY[
 'fm_find_dcpf_cn_idx','fm_find_nom_nombre_trgm_idx','fm_find_nom_cn_trgm_idx',
 'fm_find_articulos_cn_farmacia_idx','fm_find_articulos_nombre_trgm_idx',
 'fm_find_recepciones_linea_articulo_idx','fm_find_ventas_linea_articulo_idx'])
 AND (NOT ix.indisvalid OR NOT ix.indisready)
\gexec

-- El índice antiguo (dcpf WHERE generico) NO cubre presentaciones equivalentes
-- no genéricas del mismo DCPF. Este índice sí incluye TODOS los CN.
CREATE INDEX CONCURRENTLY IF NOT EXISTS fm_find_dcpf_cn_idx
 ON farmetrica.nomenclator_presentaciones(dcpf,cn);
CREATE INDEX CONCURRENTLY IF NOT EXISTS fm_find_nom_nombre_trgm_idx
 ON farmetrica.nomenclator_presentaciones USING gin (nombre gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS fm_find_nom_cn_trgm_idx
 ON farmetrica.nomenclator_presentaciones USING gin (cn gin_trgm_ops);

-- Cada cliente conserva sus propios registros y sus códigos locales del ERP.
SELECT format(
 'CREATE INDEX CONCURRENTLY IF NOT EXISTS %I ON %I.articulos ((btrim(codigo_nacional)),(upper(btrim(farmacia_codigo))),origen_id);',
 'fm_find_articulos_cn_farmacia_idx',c.esquema_datos)
FROM (SELECT DISTINCT esquema_datos FROM farmetrica.clientes) c
JOIN pg_class art_relation ON art_relation.oid=to_regclass(format('%I.articulos',c.esquema_datos))
WHERE art_relation.relkind IN ('r','m')
\gexec

SELECT format(
 'CREATE INDEX CONCURRENTLY IF NOT EXISTS %I ON %I.articulos USING gin (nombre gin_trgm_ops);',
 'fm_find_articulos_nombre_trgm_idx',c.esquema_datos)
FROM (SELECT DISTINCT esquema_datos FROM farmetrica.clientes) c
JOIN pg_class art_relation ON art_relation.oid=to_regclass(format('%I.articulos',c.esquema_datos))
WHERE art_relation.relkind IN ('r','m')
\gexec

-- PK documental optimiza documento->líneas; estos índices inversos optimizan
-- búsqueda de CN/artículo->documentos con filtro posterior de cabecera y fecha.
SELECT format(
 'CREATE INDEX CONCURRENTLY IF NOT EXISTS %I ON %I.fm_recepciones_lineas (articulo_origen_id,farmacia_codigo,sistema_origen,documento_id);',
 'fm_find_recepciones_linea_articulo_idx',c.esquema_datos)
FROM (SELECT DISTINCT esquema_datos FROM farmetrica.clientes) c
WHERE to_regclass(format('%I.fm_recepciones_lineas',c.esquema_datos)) IS NOT NULL
\gexec

SELECT format(
 'CREATE INDEX CONCURRENTLY IF NOT EXISTS %I ON %I.fm_ventas_lineas (articulo_origen_id,farmacia_codigo,sistema_origen,documento_id);',
 'fm_find_ventas_linea_articulo_idx',c.esquema_datos)
FROM (SELECT DISTINCT esquema_datos FROM farmetrica.clientes) c
WHERE to_regclass(format('%I.fm_ventas_lineas',c.esquema_datos)) IS NOT NULL
\gexec

-- Comprobar cantidad, vigencia y construcción. Un índice inválido es ERROR.
WITH expected AS (
 SELECT 'farmetrica'::text AS schema_name,v.name,v.tab FROM
 (VALUES ('fm_find_dcpf_cn_idx','nomenclator_presentaciones'),
 ('fm_find_nom_nombre_trgm_idx','nomenclator_presentaciones'),
 ('fm_find_nom_cn_trgm_idx','nomenclator_presentaciones')) v(name,tab)
 UNION ALL
 SELECT c.esquema_datos,v.name,v.tab
 FROM (SELECT DISTINCT esquema_datos FROM farmetrica.clientes) c
 CROSS JOIN (VALUES
 ('fm_find_articulos_cn_farmacia_idx','articulos'),
 ('fm_find_articulos_nombre_trgm_idx','articulos'),
 ('fm_find_recepciones_linea_articulo_idx','fm_recepciones_lineas'),
 ('fm_find_ventas_linea_articulo_idx','fm_ventas_lineas')) v(name,tab)
 JOIN pg_class indexed_relation ON indexed_relation.oid=to_regclass(format('%I.%I',c.esquema_datos,v.tab))
 WHERE indexed_relation.relkind IN ('r','m')
)
SELECT CASE WHEN count(*) FILTER(WHERE ix.indisvalid AND ix.indisready)=count(*)
  THEN 'SELECT 1 AS indices_verificados;'
  ELSE 'SELECT 1/0 AS indices_invalidos;' END
FROM expected e
 LEFT JOIN pg_namespace ns ON ns.nspname=e.schema_name
 LEFT JOIN pg_class i ON i.relnamespace=ns.oid AND i.relname=e.name
 LEFT JOIN pg_index ix ON ix.indexrelid=i.oid
\gexec

ANALYZE farmetrica.nomenclator_presentaciones;
SELECT format('ANALYZE %I.articulos;',esquema_datos)
FROM (SELECT DISTINCT esquema_datos FROM farmetrica.clientes) c
JOIN pg_class article_to_analyze ON article_to_analyze.oid=to_regclass(format('%I.articulos',esquema_datos))
WHERE article_to_analyze.relkind IN ('r','m')
\gexec
