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
-- Conservar las autorizaciones corporativas históricas: hasta ahora solo
-- existía Ampedia. No traspasar dominios públicos ni vinculaciones ajenas.
INSERT INTO farmetrica.cliente_dominios(cliente_slug,dominio,activo,farmacia_id)
SELECT 'ampedia',lower(btrim(d.dominio)),d.activo,f.id
FROM public.acceso_dominios d
LEFT JOIN farmetrica.farmacias f ON f.cliente_slug='ampedia' AND f.id=d.farmacia_id
WHERE lower(btrim(d.dominio)) ~ '^[a-z0-9-]+(\\.[a-z0-9-]+)+
 ON farmetrica.cliente_dominios(cliente_slug,activo);

CREATE TABLE IF NOT EXISTS farmetrica.restablecimientos_contrasena (
 email text PRIMARY KEY REFERENCES public.acceso_cuentas(email) ON DELETE CASCADE,
 token_hash text NOT NULL,
 caduca_en timestamptz NOT NULL,
 solicitado_en timestamptz NOT NULL DEFAULT now()
);

 AND lower(btrim(d.dominio)) NOT IN
 ('gmail.com','googlemail.com','outlook.com','hotmail.com','yahoo.com',
  'yahoo.es','icloud.com','live.com','proton.me','protonmail.com')
 AND d.activo=true
ON CONFLICT(cliente_slug,dominio) DO NOTHING;

CREATE INDEX IF NOT EXISTS cliente_dominios_activos_idx
 ON farmetrica.cliente_dominios(cliente_slug,activo);

CREATE TABLE IF NOT EXISTS farmetrica.restablecimientos_contrasena (
 email text PRIMARY KEY REFERENCES public.acceso_cuentas(email) ON DELETE CASCADE,
 token_hash text NOT NULL,
 caduca_en timestamptz NOT NULL,
 solicitado_en timestamptz NOT NULL DEFAULT now()
);
