-- OAuth privado de lectura para el conector MCP (ChatGPT y futuros clientes).
-- Idempotente. No guarda access tokens/refresh tokens en texto claro.
CREATE TABLE IF NOT EXISTS farmetrica.ai_oauth_codigos (
  code_hash text PRIMARY KEY,
  email text NOT NULL,
  metodo_acceso text NOT NULL,
  cliente_slug text NOT NULL,
  client_id text NOT NULL,
  redirect_uri text NOT NULL,
  challenge text NOT NULL,
  scope text NOT NULL,
  resource text NOT NULL,
  caduca_en timestamptz NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_oauth_codigos_caduca_idx
  ON farmetrica.ai_oauth_codigos(caduca_en);

CREATE TABLE IF NOT EXISTS farmetrica.ai_oauth_conexiones (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email text NOT NULL,
  metodo_acceso text NOT NULL,
  cliente_slug text NOT NULL,
  client_id text NOT NULL,
  resource text NOT NULL,
  scope text NOT NULL,
  access_hash text NOT NULL UNIQUE,
  refresh_hash text UNIQUE,
  access_caduca_en timestamptz NOT NULL,
  refresh_caduca_en timestamptz NOT NULL,
  revocado_en timestamptz,
  creado_en timestamptz NOT NULL DEFAULT now(),
  ultimo_uso_en timestamptz
);
CREATE INDEX IF NOT EXISTS ai_oauth_conexiones_usuario_idx
  ON farmetrica.ai_oauth_conexiones(email,creado_en DESC);
CREATE INDEX IF NOT EXISTS ai_oauth_conexiones_cliente_idx
  ON farmetrica.ai_oauth_conexiones(cliente_slug,revocado_en);

CREATE TABLE IF NOT EXISTS farmetrica.ai_oauth_auditoria (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conexion_id bigint REFERENCES farmetrica.ai_oauth_conexiones(id) ON DELETE SET NULL,
  cliente_slug text NOT NULL,
  herramienta text NOT NULL,
  consultado_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_oauth_auditoria_consultado_idx
  ON farmetrica.ai_oauth_auditoria(consultado_en DESC);

-- No retener material de autorización caducado de forma indefinida.
DELETE FROM farmetrica.ai_oauth_codigos WHERE caduca_en<now();
