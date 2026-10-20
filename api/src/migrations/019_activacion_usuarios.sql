-- Tokens de invitación y recuperación de acceso con contraseña.
-- Sin contraseñas ni enlaces en claro almacenados en base de datos.
CREATE TABLE IF NOT EXISTS farmetrica.restablecimientos_contrasena (
 email text PRIMARY KEY REFERENCES public.acceso_cuentas(email) ON DELETE CASCADE,
 token_hash text NOT NULL,
 caduca_en timestamptz NOT NULL,
 solicitado_en timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE farmetrica.restablecimientos_contrasena
 ADD COLUMN IF NOT EXISTS solicitado_en timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS restablecimientos_contrasena_caducidad
 ON farmetrica.restablecimientos_contrasena(caduca_en);
