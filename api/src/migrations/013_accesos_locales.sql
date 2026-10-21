-- Extensión aditiva: cuenta interna opcional junto al acceso Google actual.
-- No almacena contraseñas en claro. El hash scrypt lleva una sal aleatoria única.
CREATE TABLE IF NOT EXISTS farmetrica.credenciales_locales (
 email text PRIMARY KEY REFERENCES public.acceso_cuentas(email) ON DELETE CASCADE,
 password_hash text NOT NULL,
 activo boolean NOT NULL DEFAULT true,
 actualizado_en timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE farmetrica.usuario_clientes
 ADD COLUMN IF NOT EXISTS metodo_acceso text NOT NULL DEFAULT 'google';
-- Gmail personal requiere invitación explícita por cliente.
ALTER TABLE farmetrica.usuario_clientes
 ADD COLUMN IF NOT EXISTS google_invitado boolean NOT NULL DEFAULT false;
-- Compatibilidad con cuentas históricas llamadas "interno".
-- El login y la API usan ahora "local". Ejecutable repetidamente.
ALTER TABLE farmetrica.usuario_clientes
 DROP CONSTRAINT IF EXISTS usuario_clientes_metodo_acceso_check;
UPDATE farmetrica.usuario_clientes SET metodo_acceso='local' WHERE metodo_acceso='interno';
ALTER TABLE farmetrica.usuario_clientes
 ADD CONSTRAINT usuario_clientes_metodo_acceso_check
 CHECK (metodo_acceso IN ('google','local'));
