-- Registro de conciliación inicial. No bloquea las conciliaciones manuales futuras.
CREATE TABLE IF NOT EXISTS farmetrica.familias_reconciliaciones_iniciales (
 cliente_slug text PRIMARY KEY REFERENCES farmetrica.clientes(slug) ON DELETE CASCADE,
 version text NOT NULL,
 familias integer NOT NULL,
 articulos integer NOT NULL,
 pendientes integer NOT NULL,
 ejecutado_en timestamptz NOT NULL DEFAULT now()
);
