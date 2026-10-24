-- Una asignación global por proveedor del ERP. Las asignaciones específicas
-- por farmacia siguen teniendo prioridad y se conservan sin cambios.
ALTER TABLE farmetrica.proveedores_maestro
 ADD COLUMN IF NOT EXISTS laboratorio_clave text;
CREATE INDEX IF NOT EXISTS proveedores_maestro_laboratorio
 ON farmetrica.proveedores_maestro(cliente_slug,laboratorio_clave)
 WHERE laboratorio_clave IS NOT NULL;
