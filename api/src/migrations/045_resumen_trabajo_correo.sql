-- Opt-in personal para recordatorios de trabajo. Sin datos de pacientes ni envíos por defecto.
-- Requiere que la cuenta siga activa en el cliente en el momento de cada envío.
CREATE TABLE IF NOT EXISTS farmetrica.op_preferencias_correo (
 cliente_slug text NOT NULL,
 email text NOT NULL,
 frecuencia text NOT NULL DEFAULT 'desactivado'
   CHECK (frecuencia IN ('desactivado','diario','semanal')),
 dia_semana smallint NOT NULL DEFAULT 1 CHECK(dia_semana BETWEEN 1 AND 7),
 hora smallint NOT NULL DEFAULT 8 CHECK(hora BETWEEN 7 AND 19),
 ultima_fecha_procesada date,
 ultimo_intento_en timestamptz,
 actualizado_en timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(cliente_slug,email),
 FOREIGN KEY(email,cliente_slug)
   REFERENCES farmetrica.usuario_clientes(email,cliente_slug) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS op_preferencias_correo_pendientes
 ON farmetrica.op_preferencias_correo(frecuencia,ultimo_intento_en)
 WHERE frecuencia <> 'desactivado';
