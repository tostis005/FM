-- Caché persistente del ganador de la última recepción por CN.
-- Las farmacias observadas y excluidas se guardan por separado; la consulta
-- del preparador aplica el ámbito autorizado sin analizar albaranes.
CREATE TABLE IF NOT EXISTS farmetrica.preparador_ultima_recepcion_cache (
 cliente_slug text NOT NULL REFERENCES farmetrica.clientes(slug) ON DELETE CASCADE,
 cn text NOT NULL,lab_id bigint NOT NULL,nombre text NOT NULL,
 pharmacy_ids integer[] NOT NULL DEFAULT '{}',
 blocked_pharmacy_ids integer[] NOT NULL DEFAULT '{}',
 PRIMARY KEY (cliente_slug,cn)
);
CREATE INDEX IF NOT EXISTS preparador_ultima_recepcion_laboratorio_idx
 ON farmetrica.preparador_ultima_recepcion_cache (cliente_slug,lab_id);
CREATE TABLE IF NOT EXISTS farmetrica.preparador_ultima_recepcion_estado (
 cliente_slug text PRIMARY KEY REFERENCES farmetrica.clientes(slug) ON DELETE CASCADE,
 actualizado_en timestamptz NOT NULL
);
