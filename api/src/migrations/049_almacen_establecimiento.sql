-- Almacén de Ampedia: origen Farmatic independiente, sin incluirlo como farmacia comercial.
-- El sincronizador identifica todas sus filas por farmacia_codigo='ALMACEN'.
ALTER TABLE farmetrica.farmacias
 ADD COLUMN IF NOT EXISTS tipo_establecimiento text NOT NULL DEFAULT 'farmacia';

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
ON CONFLICT (cliente_slug,codigo_origen)
DO UPDATE SET
 tipo_establecimiento='almacen',
 bd_origen='Almacen',
 activo=true,
 actualizado_en=now();

-- La relación se resuelve sin suponer el ID: coincide de forma exacta con la
-- clave que emite el sincronizador (ALMACEN) en el mismo cliente.
CREATE INDEX IF NOT EXISTS farmacias_cliente_tipo_idx
 ON farmetrica.farmacias(cliente_slug,tipo_establecimiento,id);
