-- Farmétrica Sync: esquema de cabeceras vRecep unificado para las cinco farmacias.
-- Ejecutar en la base farmawao, esquema farmetrica, solo si no puede usarse
-- el botón «Actualizar tabla compras en PostgreSQL».
-- IMPORTANTE: hacer backup antes: se perderán definitivamente los valores antiguos
-- de descuento_recepcion. Nunca usar CASCADE ni recrear la tabla.
BEGIN;
ALTER TABLE IF EXISTS farmetrica.compras
    ADD COLUMN IF NOT EXISTS vendedor_id text,
    ADD COLUMN IF NOT EXISTS recepcion_actualizada boolean,
    ADD COLUMN IF NOT EXISTS recepcion_demorada boolean,
    ADD COLUMN IF NOT EXISTS fecha_hora_recepcion timestamp without time zone;
ALTER TABLE IF EXISTS farmetrica.compras
    DROP COLUMN IF EXISTS descuento_recepcion;
COMMIT;

-- Comprobación:
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'farmetrica' AND table_name = 'compras'
ORDER BY ordinal_position;
