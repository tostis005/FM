-- Cliente demo lógico: datos vivos de un origen autorizado, aislado mediante
-- esquema de VISTAS de solo lectura y maestro de farmacias independiente.
ALTER TABLE farmetrica.clientes
 ADD COLUMN IF NOT EXISTS demo_origen_slug text REFERENCES farmetrica.clientes(slug);
-- Evita ciclos y autocopias en los nuevos clientes.
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='farmetrica.clientes'::regclass
   AND conname='clientes_demo_origen_distinto') THEN
  ALTER TABLE farmetrica.clientes ADD CONSTRAINT clientes_demo_origen_distinto
   CHECK (demo_origen_slug IS NULL OR demo_origen_slug<>slug);
 END IF;
END $$;
