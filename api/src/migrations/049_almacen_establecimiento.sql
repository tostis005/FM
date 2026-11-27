-- Almacén de Ampedia: origen Farmatic independiente, sin incluirlo como farmacia comercial.
-- El sincronizador identifica todas sus filas por farmacia_codigo='ALMACEN'.
-- Evitar solicitar ACCESS EXCLUSIVE cada vez que se publica una versión.
DO $
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM pg_attribute
  WHERE attrelid='farmetrica.farmacias'::regclass
    AND attname='tipo_establecimiento' AND NOT attisdropped
 ) THEN
  ALTER TABLE farmetrica.farmacias
   ADD COLUMN tipo_establecimiento text NOT NULL DEFAULT 'farmacia';
 END IF;
END $;

DO $$
BEGIN
 IF NOT EXISTS (
  SELECT 1 FROM pg_constraint
  WHERE conrelid='farmetrica.farmacias'::regclass
   AND conname='farmacias_tipo_establecimiento_ck'
 ) THEN
  ALTER TABLE farmetrica.farmacias
   ADD CONSTRAINT farmacias_tipo_establecimiento_ck
   CHECK (tipo_establecimiento IN ('farmacia','almacen'));
 END IF;
END $$;

-- No fijar arbitrariamente el entero: la identidad PostgreSQL asigna un ID
-- libre y estable, protegido por UNIQUE(cliente_slug,codigo_origen).
INSERT INTO farmetrica.farmacias
 (cliente_slug,nombre,ciudad,activo,codigo_origen,host_origen,bd_origen,tipo_establecimiento)
SELECT 'ampedia','Almacén central','',true,'ALMACEN',NULL,'Almacen','almacen'
WHERE EXISTS (SELECT 1 FROM farmetrica.clientes WHERE slug='ampedia')
 AND NOT EXISTS (SELECT 1 FROM farmetrica.farmacias WHERE cliente_slug='ampedia' AND codigo_origen='ALMACEN')
ON CONFLICT (cliente_slug,codigo_origen) DO NOTHING;
-- No volver a activar automáticamente el almacén en cada despliegue.
-- El tipo y el estado son ahora configurables por cliente.

-- La relación se resuelve sin suponer el ID: coincide de forma exacta con la
-- clave que emite el sincronizador (ALMACEN) en el mismo cliente.
DO $
BEGIN
 IF to_regclass('farmetrica.farmacias_cliente_tipo_idx') IS NULL THEN
  CREATE INDEX farmacias_cliente_tipo_idx
   ON farmetrica.farmacias(cliente_slug,tipo_establecimiento,id);
 END IF;
END $;
