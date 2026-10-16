-- Acceso FARMAWAO: las reglas y las cuentas solo se administran desde API autenticada.
-- Migración idempotente, sin eliminar farmacias, promociones ni ventas.
CREATE TABLE IF NOT EXISTS public.acceso_dominios (
  dominio TEXT PRIMARY KEY,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  farmacia_id INTEGER REFERENCES public.farmacias(id),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.acceso_cuentas (
  email TEXT PRIMARY KEY,
  nombre TEXT NOT NULL DEFAULT '',
  rol TEXT NOT NULL DEFAULT 'farmacia'
    CHECK (rol IN ('administrador','gestor','farmacia','colaborador')),
  farmacias INTEGER[] NOT NULL DEFAULT '{}',
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_acceso_cuentas_activas ON public.acceso_cuentas(activo);

-- Contraseña local rotada, exclusiva por cuenta. No se devuelve desde la API.
ALTER TABLE public.acceso_cuentas ADD COLUMN IF NOT EXISTS clave_local_hash TEXT;

CREATE TABLE IF NOT EXISTS public.acceso_codigos (
  email TEXT PRIMARY KEY REFERENCES public.acceso_cuentas(email) ON DELETE CASCADE,
  codigo_hash TEXT NOT NULL,
  caduca_en TIMESTAMPTZ NOT NULL,
  intentos INTEGER NOT NULL DEFAULT 0,
  enviado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- No se precargan dominios: un administrador los habilita expresamente.
-- ADMIN_BOOTSTRAP_EMAILS (VPS) crea las primeras cuentas administrativas.
