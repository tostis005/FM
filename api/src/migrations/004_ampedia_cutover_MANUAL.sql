-- 004 · CAMBIO FÍSICO DEL ESQUEMA DENTRO DE UNA TRANSACCIÓN.
-- Requiere: resolución dinámica del esquema en la API y preflight correcto.
-- La ejecución en producción se coordina con el despliegue de API y web.
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
-- Capa de compatibilidad para integraciones antiguas que consultan farmatic.*
-- Se construyen vistas simples de una tabla, actualizables para INSERT/UPDATE
-- ordinario. Los clientes que usen COPY FROM sobre la tabla anterior deberán
-- actualizar su destino a ampedia.*.
CREATE SCHEMA farmatic;
DO $compat$
DECLARE relation record;
BEGIN
  FOR relation IN
    SELECT tablename FROM pg_tables WHERE schemaname='ampedia'
  LOOP
    EXECUTE format('CREATE VIEW farmatic.%I AS SELECT * FROM ampedia.%I',
      relation.tablename,relation.tablename);
  END LOOP;
END $compat$;
COMMIT;

-- IMPORTANTE: referencias SQL literales, procedimientos, ETLs y aplicaciones externas
-- que apuntaban a farmatic.* deben migrarse de manera coordinada; la operación
-- ALTER SCHEMA no reescribe esas referencias. Verificar antes de ejecución.
