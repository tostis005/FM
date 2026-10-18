-- Preferencias de análisis comercial por CLIENTE, no por usuario ni navegador.
-- No modifica ni precalcula movimientos. 12 meses si no se configura.
ALTER TABLE farmetrica.clientes
  ADD COLUMN IF NOT EXISTS analisis_abcd_meses integer NOT NULL DEFAULT 12;
ALTER TABLE farmetrica.clientes
  DROP CONSTRAINT IF EXISTS clientes_analisis_abcd_meses_check;
ALTER TABLE farmetrica.clientes
  ADD CONSTRAINT clientes_analisis_abcd_meses_check
    CHECK (analisis_abcd_meses IN (3,6,12,24,36));
