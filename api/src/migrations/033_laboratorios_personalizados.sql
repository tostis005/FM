-- Identidades de laboratorio/proveedor propias del cliente, independientes del Nomenclátor.
-- No se reescriben proveedores originales de Farmatic ni sus recepciones.
-- Los alias por farmacia siguen en proveedores_laboratorios (migración 026).
CREATE TABLE IF NOT EXISTS farmetrica.laboratorios_personalizados (
 cliente_slug text NOT NULL REFERENCES farmetrica.clientes(slug) ON DELETE CASCADE,
 laboratorio_clave text NOT NULL,
 nombre text NOT NULL,
 creado_en timestamptz NOT NULL DEFAULT now(),
 actualizado_en timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(cliente_slug,laboratorio_clave),
 CHECK (laboratorio_clave ~ '^N:[A-Z0-9 ]{3,210}$'),
 CHECK (length(btrim(nombre)) BETWEEN 3 AND 200)
);
CREATE INDEX IF NOT EXISTS laboratorios_personalizados_nombre
 ON farmetrica.laboratorios_personalizados(cliente_slug,upper(btrim(nombre)));
