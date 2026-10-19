-- Indicadores de proveedor gestionados por cliente. No modifica movimientos del ERP.
ALTER TABLE farmetrica.proveedores_maestro
 ADD COLUMN IF NOT EXISTS cooperativa boolean NOT NULL DEFAULT false;
ALTER TABLE farmetrica.proveedores_maestro
 ADD COLUMN IF NOT EXISTS ignorar_informes boolean NOT NULL DEFAULT false;

-- Respetar la clasificación histórica antes de separar atributo y tipo.
UPDATE farmetrica.proveedores_maestro
 SET cooperativa=true
 WHERE tipo='cooperativa' AND cooperativa=false;

CREATE INDEX IF NOT EXISTS proveedores_maestro_exclusiones
 ON farmetrica.proveedores_maestro (cliente_slug,upper(btrim(codigo_origen)))
 WHERE ignorar_informes=true;
CREATE INDEX IF NOT EXISTS proveedores_maestro_exclusiones_nombre
 ON farmetrica.proveedores_maestro (cliente_slug,upper(btrim(nombre)))
 WHERE ignorar_informes=true;
