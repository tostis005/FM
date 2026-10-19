-- Indicadores de proveedor gestionados por cliente. No modifica movimientos del ERP.
-- La conversión histórica debe suceder SOLO una vez.
-- En despliegues posteriores respetar si el usuario ha desmarcado el check.
DO $fm_supplier_flags$
BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM information_schema.columns
   WHERE table_schema='farmetrica' AND table_name='proveedores_maestro'
     AND column_name='cooperativa'
 ) THEN
   ALTER TABLE farmetrica.proveedores_maestro
     ADD COLUMN cooperativa boolean NOT NULL DEFAULT false;
   UPDATE farmetrica.proveedores_maestro SET cooperativa=true WHERE tipo='cooperativa';
 END IF;
END $fm_supplier_flags$;
ALTER TABLE farmetrica.proveedores_maestro
 ADD COLUMN IF NOT EXISTS ignorar_informes boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS proveedores_maestro_exclusiones
 ON farmetrica.proveedores_maestro (cliente_slug,upper(btrim(codigo_origen)))
 WHERE ignorar_informes=true;
CREATE INDEX IF NOT EXISTS proveedores_maestro_exclusiones_nombre
 ON farmetrica.proveedores_maestro (cliente_slug,upper(btrim(nombre)))
 WHERE ignorar_informes=true;
