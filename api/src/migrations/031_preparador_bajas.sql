-- Cadenas de baja añadidas por el administrador de cada cliente.
-- Los prefijos seguros ZZZ y *BAJA se reconocen en el servidor sin registros iniciales.
CREATE TABLE IF NOT EXISTS farmetrica.preparador_exclusiones (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 cliente_slug text NOT NULL REFERENCES farmetrica.clientes(slug) ON DELETE CASCADE,
 cadena text NOT NULL CHECK (char_length(cadena) BETWEEN 3 AND 80),
 creado_en timestamptz NOT NULL DEFAULT now(),
 UNIQUE(cliente_slug,cadena)
);
CREATE INDEX IF NOT EXISTS preparador_exclusiones_cliente
 ON farmetrica.preparador_exclusiones(cliente_slug);
