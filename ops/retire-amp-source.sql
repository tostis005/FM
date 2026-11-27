-- Retirada del origen histórico AMP exclusivamente en el cliente Ampedia.
-- Se mueven filas, no se renombran ni se pisan las de ALMACEN.
-- Cada lote copia las filas retiradas y las borra en una única transacción.
-- Ejecución explícita, reanudable; NO forma parte de migraciones automáticas.
\set ON_ERROR_STOP on
SET lock_timeout='5s';
SET statement_timeout='0';
SELECT pg_advisory_lock(hashtext('fm_retire_amp_source_20261127'));
DO $guard$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM farmetrica.farmacias WHERE cliente_slug='ampedia'
                AND upper(btrim(codigo_origen))='ALMACEN' AND activo
                AND tipo_establecimiento='almacen') THEN
  RAISE EXCEPTION 'Falta el almacén canónico';
 END IF;
 IF EXISTS (SELECT 1 FROM farmetrica.farmacias WHERE cliente_slug='ampedia'
            AND upper(btrim(codigo_origen))='AMP') THEN
  RAISE EXCEPTION 'Existe ficha independiente del origen retirado; revisar manualmente';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM ampedia.fm_recepciones_cabeceras WHERE farmacia_codigo='ALMACEN') THEN
  RAISE EXCEPTION 'No hay recepciones del almacén canónico';
 END IF;
END;
$guard$;
CREATE SCHEMA IF NOT EXISTS fm_archive_amp_20261127;
REVOKE ALL ON SCHEMA fm_archive_amp_20261127 FROM PUBLIC;
CREATE TABLE IF NOT EXISTS fm_archive_amp_20261127.manifest (
 source_schema text NOT NULL,source_table text NOT NULL,backup_table text NOT NULL,
 priority integer NOT NULL,archived_rows bigint NOT NULL DEFAULT 0,
 completed boolean NOT NULL DEFAULT false,updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(source_schema,source_table)
);
CREATE TEMP TABLE fm_amp_plan (
 source_schema text,source_table text,predicate text,priority integer,
 PRIMARY KEY(source_schema,source_table)
) ON COMMIT PRESERVE ROWS;
-- Las tablas del esquema Ampedia son propias del cliente. En el maestro
-- común se exige además cliente_slug. Nunca borrar por nombre ni por CN.
INSERT INTO fm_amp_plan
SELECT c.table_schema,c.table_name,
 CASE WHEN c.table_schema='farmetrica' THEN 't.cliente_slug=''ampedia'' AND ' ELSE '' END||
 't.farmacia_codigo=''AMP''',
 CASE
  WHEN c.table_name IN ('fm_ventas_lineas','fm_recepciones_lineas','fm_pedidos_lineas') THEN 10
  WHEN c.table_name IN ('fm_ventas_cabeceras','fm_recepciones_cabeceras','fm_pedidos_cabeceras','fm_sync_ejecuciones') THEN 80
  ELSE 40 END
FROM information_schema.columns c
JOIN information_schema.tables t USING(table_schema,table_name)
WHERE c.column_name='farmacia_codigo' AND t.table_type='BASE TABLE'
 AND (c.table_schema='ampedia' OR (c.table_schema='farmetrica'
  AND EXISTS (SELECT 1 FROM information_schema.columns x
   WHERE x.table_schema=c.table_schema AND x.table_name=c.table_name AND x.column_name='cliente_slug')));
-- Rechazos del sincronizador: dependen de la ejecución, no llevan código propio.
INSERT INTO fm_amp_plan VALUES ('ampedia','fm_sync_rechazos',
 'EXISTS (SELECT 1 FROM ampedia.fm_sync_ejecuciones e WHERE e.ejecucion_id=t.ejecucion_id AND e.farmacia_codigo=''AMP'')',5)
ON CONFLICT DO NOTHING;
DELETE FROM fm_amp_plan WHERE to_regclass(format('%I.%I',source_schema,source_table)) IS NULL;
-- No permitir una cascada o modificación de tablas no cubiertas por la copia.
DO $guard$
BEGIN
 IF EXISTS (
  SELECT 1 FROM pg_constraint c
  JOIN fm_amp_plan p ON c.confrelid=to_regclass(format('%I.%I',p.source_schema,p.source_table))
  LEFT JOIN fm_amp_plan child ON c.conrelid=to_regclass(format('%I.%I',child.source_schema,child.source_table))
  WHERE c.contype='f' AND c.confdeltype IN ('c','n','d')
    AND (child.source_table IS NULL OR child.priority>=p.priority)
 ) THEN RAISE EXCEPTION 'Dependencia con cascada no cubierta por el plan; no se retiran filas'; END IF;
END;
$guard$;
-- Evitar una copia grande si no hay capacidad suficiente en el volumen
-- PostgreSQL. Se usa una muestra real de filas y margen para WAL/TOAST.
CREATE TEMP TABLE fm_amp_space AS SELECT :'free_kb'::bigint*1024 AS bytes;
DO $space$
DECLARE item record; n bigint; sample numeric; estimated numeric:=0; free_bytes bigint; variant boolean;
BEGIN
 SELECT bytes INTO free_bytes FROM fm_amp_space;
 FOR item IN SELECT * FROM fm_amp_plan LOOP
  IF item.source_table<>'fm_sync_rechazos' THEN
   EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.%I t WHERE upper(btrim(t.farmacia_codigo::text))=''AMP'' AND t.farmacia_codigo<>''AMP''%s)',
    item.source_schema,item.source_table,CASE WHEN item.source_schema='farmetrica' THEN ' AND t.cliente_slug=''ampedia''' ELSE '' END) INTO variant;
   IF variant THEN RAISE EXCEPTION 'Variante de código no normalizado; requiere revisión'; END IF;
  END IF;
  EXECUTE format('SELECT count(*) FROM %I.%I t WHERE %s',item.source_schema,item.source_table,item.predicate) INTO n;
  IF n>0 THEN
   EXECUTE format('SELECT avg(sz) FROM (SELECT pg_column_size(t) AS sz FROM %I.%I t WHERE %s LIMIT 5000) sample',
    item.source_schema,item.source_table,item.predicate) INTO sample;
   estimated:=estimated+n*(greatest(coalesce(sample,0),128)+64);
  END IF;
 END LOOP;
 IF free_bytes IS NULL OR free_bytes < 3*estimated+2147483648 THEN
  RAISE EXCEPTION 'Espacio insuficiente para archivo y WAL; no se retiran filas';
 END IF;
END;
$space$;
-- El DO se ejecuta a nivel superior para poder confirmar cada lote.
DO $archive$
DECLARE item record; backup_name text; moved bigint; existing bigint; archived bigint;
BEGIN
 FOR item IN SELECT * FROM fm_amp_plan ORDER BY priority,source_schema,source_table LOOP
  backup_name:=item.source_schema||'__'||item.source_table;
  IF length(backup_name)>63 THEN RAISE EXCEPTION 'Nombre de respaldo demasiado largo'; END IF;
  EXECUTE format('CREATE TABLE IF NOT EXISTS fm_archive_amp_20261127.%I AS SELECT * FROM %I.%I WITH NO DATA',
   backup_name,item.source_schema,item.source_table);
  INSERT INTO fm_archive_amp_20261127.manifest(source_schema,source_table,backup_table,priority)
   VALUES(item.source_schema,item.source_table,backup_name,item.priority)
   ON CONFLICT(source_schema,source_table) DO NOTHING;
  COMMIT;
  LOOP
   EXECUTE format(
    'WITH picked AS MATERIALIZED (SELECT t.tableoid AS oid,t.ctid AS tid FROM %I.%I t WHERE %s LIMIT 50000 FOR UPDATE),
      moved AS (DELETE FROM %I.%I t USING picked p WHERE t.tableoid=p.oid AND t.ctid=p.tid RETURNING t.*)
     INSERT INTO fm_archive_amp_20261127.%I SELECT * FROM moved',
     item.source_schema,item.source_table,item.predicate,item.source_schema,item.source_table,backup_name);
   GET DIAGNOSTICS moved=ROW_COUNT;
   UPDATE fm_archive_amp_20261127.manifest SET archived_rows=archived_rows+moved,updated_at=now()
    WHERE source_schema=item.source_schema AND source_table=item.source_table;
   COMMIT;
   EXIT WHEN moved=0;
  END LOOP;
  EXECUTE format('SELECT count(*) FROM fm_archive_amp_20261127.%I',backup_name) INTO existing;
  SELECT archived_rows INTO archived FROM fm_archive_amp_20261127.manifest
   WHERE source_schema=item.source_schema AND source_table=item.source_table;
  IF existing<>archived THEN RAISE EXCEPTION 'El respaldo no coincide con el registro de lotes'; END IF;
  EXECUTE format('SELECT count(*) FROM %I.%I t WHERE %s',item.source_schema,item.source_table,item.predicate) INTO existing;
  IF existing<>0 THEN RAISE EXCEPTION 'Persisten filas del origen retirado'; END IF;
  UPDATE fm_archive_amp_20261127.manifest SET completed=true,updated_at=now()
   WHERE source_schema=item.source_schema AND source_table=item.source_table;
  COMMIT;
 END LOOP;
END;
$archive$;
REVOKE ALL ON ALL TABLES IN SCHEMA fm_archive_amp_20261127 FROM PUBLIC;
UPDATE farmetrica.preparador_ultima_recepcion_estado SET actualizado_en=to_timestamp(0) WHERE cliente_slug='ampedia';
-- Solo estados técnicos en los logs; los importes y el contenido permanecen en PostgreSQL.
SELECT CASE WHEN bool_and(completed) THEN 'FM_ARCHIVE_OK' ELSE 'FM_ARCHIVE_INCOMPLETE' END FROM fm_archive_amp_20261127.manifest;
SELECT pg_advisory_unlock(hashtext('fm_retire_amp_source_20261127'));
