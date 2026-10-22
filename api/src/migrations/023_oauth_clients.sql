-- Public OAuth clients: registration alone grants no access to pharmacy data.
CREATE TABLE IF NOT EXISTS farmetrica.ai_oauth_clientes (
  client_id text PRIMARY KEY,
  metadata jsonb NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now()
);
