-- Promociones persistidas en el esquema de datos de Ampedia.
-- Ejecutar después del cutover de farmatic a ampedia.
-- Aditivo: no altera ventas ni borra promociones previamente importadas.
CREATE TABLE IF NOT EXISTS ampedia.fm_promociones (
  id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 120),
  documento jsonb NOT NULL CHECK (jsonb_typeof(documento) = 'object'),
  fuente text,
  creado_por text,
  actualizado_por text,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fm_promociones_actualizadas
  ON ampedia.fm_promociones (actualizado_en DESC);
CREATE TABLE IF NOT EXISTS ampedia.fm_promocion_revisiones (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  promocion_id text NOT NULL,
  documento_anterior jsonb NOT NULL,
  cambiado_por text NOT NULL,
  cambiado_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fm_promocion_revisiones_promocion
  ON ampedia.fm_promocion_revisiones(promocion_id,cambiado_en DESC);

-- Se preserva el Excel interpretado en documento:
-- códigos, objetivos, descripciones, advertencias, fuente y demás metadatos.
-- Los datos históricos de localStorage NO pueden migrarse desde PostgreSQL:
-- la web ofrece una acción explícita de importación al servidor.
