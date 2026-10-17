-- 004 · EJECUCIÓN MANUAL EN VENTANA DE MANTENIMIENTO, NO EN EL ARRANQUE.
-- Requiere: backup verificado de PostgreSQL, comprobación de dependencias,
-- API actualizada a resolución dinámica del esquema y plan de rollback.
-- Ejecutar como una sola transacción con ON_ERROR_STOP=1.
BEGIN;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='farmatic') THEN
    RAISE EXCEPTION 'Esquema de origen farmatic no encontrado';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='ampedia') THEN
    RAISE EXCEPTION 'ampedia ya existe: detener, no combinar esquemas';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema='farmatic' AND table_name='lineaventa') THEN
    RAISE EXCEPTION 'farmatic.lineaventa no existe: comprobar base correcta';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM farmetrica.clientes
                 WHERE slug='ampedia' AND esquema_datos='farmatic') THEN
    RAISE EXCEPTION 'Registro de cliente no coincide con esquema original';
  END IF;
END $$;

ALTER SCHEMA farmatic RENAME TO ampedia;
UPDATE farmetrica.clientes SET esquema_datos='ampedia'
 WHERE slug='ampedia' AND esquema_datos='farmatic';
COMMIT;

-- IMPORTANTE: referencias SQL literales, procedimientos, ETLs y aplicaciones externas
-- que apuntaban a farmatic.* deben migrarse de manera coordinada; la operación
-- ALTER SCHEMA no reescribe esas referencias. Verificar antes de ejecución.
