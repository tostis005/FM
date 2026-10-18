-- Configuración persistida por CLIENTE, sin caché ni precálculo de datos.
ALTER TABLE farmetrica.clientes
 ADD COLUMN IF NOT EXISTS analisis_abcd_meses integer NOT NULL DEFAULT 12;
DO $$
BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM pg_constraint
   WHERE conrelid='farmetrica.clientes'::regclass
     AND conname='clientes_analisis_abcd_meses_check'
 ) THEN
   ALTER TABLE farmetrica.clientes
    ADD CONSTRAINT clientes_analisis_abcd_meses_check
    CHECK (analisis_abcd_meses IN (3,6,12,24,36));
 END IF;
END $$;
