-- Mantenimiento ÚNICO autorizado de Ampedia, 19/10/2026.
-- Respalda TODOS los documentos en una tabla propia y en el historial antes
-- de vaciar el catálogo actual. Otras farmacias/clientes NO se modifican.
-- Protegido con marca de ejecución para evitar borrados al reintentar.
\set ON_ERROR_STOP on
BEGIN;
SELECT pg_advisory_xact_lock(20261019, 1107);
LOCK TABLE ampedia.fm_promociones IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE IF NOT EXISTS ampedia.fm_promociones_respaldo_20261019(
 id text PRIMARY KEY,
 documento jsonb NOT NULL,
 respaldado_en timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE
  total_antes integer;
  copiados integer;
  eliminados integer;
BEGIN
  IF EXISTS (
    SELECT 1 FROM ampedia.fm_promocion_revisiones
    WHERE promocion_id='__CATALOG_RESET_20261019__'
  ) THEN
    RAISE NOTICE 'La limpieza ya estaba registrada; no se vuelve a borrar ninguna promoción';
    RETURN;
  END IF;

  SELECT count(*) INTO total_antes FROM ampedia.fm_promociones;

  INSERT INTO ampedia.fm_promociones_respaldo_20261019(id,documento)
  SELECT id,documento FROM ampedia.fm_promociones
  ON CONFLICT (id) DO NOTHING;

  SELECT count(*) INTO copiados
  FROM ampedia.fm_promociones_respaldo_20261019;
  IF copiados < total_antes THEN
    RAISE EXCEPTION 'No se ha completado el respaldo de las promociones (% de %)',
      copiados,total_antes;
  END IF;

  INSERT INTO ampedia.fm_promocion_revisiones
   (promocion_id,documento_anterior,cambiado_por)
  SELECT id,
    documento || jsonb_build_object(
      'deletedAt',now()::text,
      'deletedReason','Limpieza total del catálogo de promociones (19/10/2026)'),
    'mantenimiento:limpieza-promociones-20261019'
  FROM ampedia.fm_promociones;

  DELETE FROM ampedia.fm_promociones;
  GET DIAGNOSTICS eliminados = ROW_COUNT;
  IF eliminados <> total_antes THEN
    RAISE EXCEPTION 'Recuento de eliminación inesperado: %, esperadas %',
      eliminados,total_antes;
  END IF;

  -- La web deja de recuperar copias antiguas del navegador tras esta marca.
  INSERT INTO ampedia.fm_promocion_revisiones
   (promocion_id,documento_anterior,cambiado_por)
  VALUES ('__CATALOG_RESET_20261019__',
    jsonb_build_object('catalogResetAt',now()::text,
      'removedCount',eliminados,'source','Mantenimiento solicitado por usuario'),
    'mantenimiento:limpieza-promociones-20261019');

  RAISE NOTICE 'Limpieza Ampedia confirmada: % eliminadas, % respaldadas',
    eliminados,copiados;
END $$;
COMMIT;

SELECT count(*) AS promociones_actuales FROM ampedia.fm_promociones;
SELECT count(*) AS promociones_respaldo
FROM ampedia.fm_promociones_respaldo_20261019;
