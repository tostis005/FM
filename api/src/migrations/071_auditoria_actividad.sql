
-- Registro de seguridad aislado por cliente, sin datos clínicos ni contenido de ficheros.
CREATE TABLE IF NOT EXISTS farmetrica.audit_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 cliente_slug text NOT NULL REFERENCES farmetrica.clientes(slug) ON DELETE CASCADE,
 actor text NOT NULL,
 actor_role text NOT NULL,
 occurred_at timestamptz NOT NULL DEFAULT now(),
 action text NOT NULL CHECK (action IN ('login','page','export_requested','document_download','tariff_download','mutation','denied','audit_read')),
 section text NOT NULL,
 source text NOT NULL CHECK (source IN ('server','browser')),
 severity text NOT NULL CHECK (severity IN ('normal','high','critical')),
 detail text NOT NULL DEFAULT '',
 records integer CHECK(records >= 0),
 bytes integer CHECK(bytes >= 0),
 bucket bigint
);
CREATE INDEX IF NOT EXISTS audit_events_tenant_time_idx ON farmetrica.audit_events(cliente_slug,occurred_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS audit_events_actor_time_idx ON farmetrica.audit_events(cliente_slug,actor,occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_retention_idx ON farmetrica.audit_events(occurred_at);
CREATE UNIQUE INDEX IF NOT EXISTS audit_page_bucket_idx ON farmetrica.audit_events(cliente_slug,actor,section,bucket) WHERE action='page';
REVOKE ALL ON farmetrica.audit_events FROM PUBLIC;
