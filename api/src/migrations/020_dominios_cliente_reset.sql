-- 020: dominios SSO aislados por cliente + restablecimiento seguro de cuentas externas.
-- Migración aditiva: no migra automáticamente el listado global heredado.
CREATE TABLE IF NOT EXISTS farmetrica.cliente_dominios (
 cliente_slug text NOT NULL REFERENCES farmetrica.clientes(slug) ON DELETE CASCADE,
 dominio text NOT NULL,
 activo boolean NOT NULL DEFAULT true,
 farmacia_id integer REFERENCES farmetrica.farmacias(id),
 creado_en timestamptz NOT NULL DEFAULT now(),
 actualizado_en timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (cliente_slug,dominio),
 UNIQUE (dominio)
);
CREATE INDEX IF NOT EXISTS cliente_dominios_activos_idx
 ON farmetrica.cliente_dominios(cliente_slug,activo);

CREATE TABLE IF NOT EXISTS farmetrica.restablecimientos_contrasena (
 email text PRIMARY KEY REFERENCES public.acceso_cuentas(email) ON DELETE CASCADE,
 token_hash text NOT NULL,
 caduca_en timestamptz NOT NULL,
 solicitado_en timestamptz NOT NULL DEFAULT now()
);
