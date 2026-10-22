-- Una única clave de integración para el MCP demo, revocable por superadministrador.
-- Se almacena exclusivamente su hash SHA-256. Nunca persistir el secreto claro.
CREATE TABLE IF NOT EXISTS farmetrica.ai_mcp_demo_keys (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton=true),
  secret_hash text NOT NULL CHECK(secret_hash ~ '^[0-9a-f]{64}$'),
  cliente_slug text NOT NULL REFERENCES farmetrica.clientes(slug),
  creado_en timestamptz NOT NULL DEFAULT now()
);
