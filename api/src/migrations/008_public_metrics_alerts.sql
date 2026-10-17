-- 008. Métricas públicas agregadas y avisos transaccionales.
-- No se guardan IPs, agentes de usuario, cookies ni identificadores de visitante.
CREATE TABLE IF NOT EXISTS farmetrica.visitas_publicas (
  dia date NOT NULL,
  ruta varchar(160) NOT NULL,
  visitas integer NOT NULL DEFAULT 0 CHECK(visitas >= 0),
  PRIMARY KEY(dia, ruta)
);
ALTER TABLE farmetrica.solicitudes_demo
  ADD COLUMN IF NOT EXISTS aviso_intentado_en timestamptz,
  ADD COLUMN IF NOT EXISTS aviso_enviado_en timestamptz;
ALTER TABLE farmetrica.solicitudes_privacidad
  ADD COLUMN IF NOT EXISTS aviso_intentado_en timestamptz,
  ADD COLUMN IF NOT EXISTS aviso_enviado_en timestamptz;
