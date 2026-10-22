-- Duración configurable del enlace de lectura real.
-- Compatible con los enlaces existentes: siguen caducando a las 24 horas.
-- Idempotente incluso si hay enlaces sin caducidad.
ALTER TABLE farmetrica.ai_mcp_demo_keys
  ADD COLUMN IF NOT EXISTS duracion text NOT NULL DEFAULT '24h';

DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint
   WHERE conrelid='farmetrica.ai_mcp_demo_keys'::regclass
     AND conname='ai_share_link_duration_check') THEN
  ALTER TABLE farmetrica.ai_mcp_demo_keys
   ADD CONSTRAINT ai_share_link_duration_check
    CHECK (duracion IN ('24h','7d','30d','365d','indefinido'));
 END IF;
END $$;
