-- Optimización de consultas sobre ventas_completas y recepciones_completas.
-- Ejecutar con psql FUERA de cualquier transacción (CREATE INDEX CONCURRENTLY).
-- Se limita a esquemas registrados por Farmétrica con tablas documentales.
-- Conserva PK e índices previos y no bloquea escrituras del sincronizador.
\set ON_ERROR_STOP on
SET lock_timeout = '12s';
SET statement_timeout = '35min';

-- Un deadlock puede dejar un índice concurrente inválido. Se retiran
-- únicamente nuestros índices dañados, nunca los índices de ERP o PK.
SELECT format('DROP INDEX CONCURRENTLY IF EXISTS %I.%I;',ns.nspname,idx.relname)
FROM pg_class idx
JOIN pg_namespace ns ON ns.oid=idx.relnamespace
JOIN pg_index ix ON ix.indexrelid=idx.oid
WHERE ns.nspname IN (SELECT DISTINCT esquema_datos FROM farmetrica.clientes)
  AND idx.relname IN ('fm_doc_ventas_codigo_fecha_idx','fm_doc_recepciones_codigo_fecha_idx',
                     'fm_state_ventas_recibido_idx','fm_state_recepciones_recibido_idx')
  AND (NOT ix.indisvalid OR NOT ix.indisready)
\gexec

-- Filtro más habitual: farmacia (normalizada) y periodo, con fecha descendente.
-- El predicado parcial coincide con las vistas analíticas (sólo documentos
-- completos y no borrados). La PK existente resuelve después las líneas
-- mediante (farmacia_codigo,sistema_origen,documento_id).
SELECT format(
 'CREATE INDEX CONCURRENTLY IF NOT EXISTS %I ON %I.fm_ventas_cabeceras ((upper(btrim(farmacia_codigo))), fecha DESC, sistema_origen, documento_id) WHERE lineas_completas AND NOT eliminado_logicamente;',
 'fm_doc_ventas_codigo_fecha_idx',c.esquema_datos)
FROM (SELECT DISTINCT esquema_datos FROM farmetrica.clientes) c
WHERE to_regclass(format('%I.fm_ventas_cabeceras',c.esquema_datos)) IS NOT NULL
\gexec

SELECT format(
 'CREATE INDEX CONCURRENTLY IF NOT EXISTS %I ON %I.fm_recepciones_cabeceras ((upper(btrim(farmacia_codigo))), fecha DESC, sistema_origen, documento_id) WHERE lineas_completas AND NOT eliminada_logicamente;',
 'fm_doc_recepciones_codigo_fecha_idx',c.esquema_datos)
FROM (SELECT DISTINCT esquema_datos FROM farmetrica.clientes) c
WHERE to_regclass(format('%I.fm_recepciones_cabeceras',c.esquema_datos)) IS NOT NULL
\gexec

-- Estado de farmacias: búsqueda O(log n) de la última recepción de cada
-- farmacia, incluso cuando se importan documentos históricos fuera de orden.
-- Índices independientes de lineas_completas: el estado muestra toda llegada.
SELECT format(
 'CREATE INDEX CONCURRENTLY IF NOT EXISTS %I ON %I.fm_ventas_cabeceras ((upper(btrim(farmacia_codigo))), recibido_en DESC) INCLUDE (fecha);',
 'fm_state_ventas_recibido_idx',c.esquema_datos)
FROM (SELECT DISTINCT esquema_datos FROM farmetrica.clientes) c
WHERE to_regclass(format('%I.fm_ventas_cabeceras',c.esquema_datos)) IS NOT NULL
\\gexec

SELECT format(
 'CREATE INDEX CONCURRENTLY IF NOT EXISTS %I ON %I.fm_recepciones_cabeceras ((upper(btrim(farmacia_codigo))), recibido_en DESC) INCLUDE (fecha);',
 'fm_state_recepciones_recibido_idx',c.esquema_datos)
FROM (SELECT DISTINCT esquema_datos FROM farmetrica.clientes) c
WHERE to_regclass(format('%I.fm_recepciones_cabeceras',c.esquema_datos)) IS NOT NULL
\\gexec

-- Verificar que el índice sea válido, visible para el planificador y usable.
WITH expected AS (
 SELECT DISTINCT c.esquema_datos AS schema_name,v.index_name,v.table_name
 FROM farmetrica.clientes c
 CROSS JOIN (VALUES
  ('fm_doc_ventas_codigo_fecha_idx','fm_ventas_cabeceras'),
  ('fm_doc_recepciones_codigo_fecha_idx','fm_recepciones_cabeceras'),
  ('fm_state_ventas_recibido_idx','fm_ventas_cabeceras'),
  ('fm_state_recepciones_recibido_idx','fm_recepciones_cabeceras')
 ) v(index_name,table_name)
 WHERE to_regclass(format('%I.%I',c.esquema_datos,v.table_name)) IS NOT NULL
), checked AS (
 SELECT e.*,(ix.indisvalid AND ix.indisready) AS ok
 FROM expected e
 LEFT JOIN pg_namespace ns ON ns.nspname=e.schema_name
 LEFT JOIN pg_class idx ON idx.relnamespace=ns.oid AND idx.relname=e.index_name
 LEFT JOIN pg_index ix ON ix.indexrelid=idx.oid
)
SELECT format('Índices documentales: %s válidos de %s previstos',
 count(*) FILTER(WHERE ok),count(*))
FROM checked;

-- Estadísticas frescas tras la creación, sin ANALYZE de tablas heredadas.
SELECT format('ANALYZE %I.%I;',c.esquema_datos,tab.name)
FROM (SELECT DISTINCT esquema_datos FROM farmetrica.clientes) c
CROSS JOIN (VALUES ('fm_ventas_cabeceras'),('fm_recepciones_cabeceras')) tab(name)
WHERE to_regclass(format('%I.%I',c.esquema_datos,tab.name)) IS NOT NULL
\gexec
