-- Maestro de familias por cliente: identidad global editable y equivalencias ERP.
-- No altera familias/artículos de los orígenes ni confunde códigos entre farmacias.
CREATE TABLE IF NOT EXISTS farmetrica.familias_globales (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 cliente_slug text NOT NULL REFERENCES farmetrica.clientes(slug) ON DELETE CASCADE,
 clave text NOT NULL,
 nombre text NOT NULL CHECK (length(btrim(nombre)) BETWEEN 1 AND 200),
 segmento text NOT NULL DEFAULT 'SIN_DETERMINAR'
  CHECK (segmento IN ('MEDICACION','PARAFARMACIA','SIN_DETERMINAR')),
 referencia_farmacia text,
 referencia_codigo text,
 nombre_manual boolean NOT NULL DEFAULT false,
 activo boolean NOT NULL DEFAULT true,
 fusionado_a bigint,
 actualizado_en timestamptz NOT NULL DEFAULT now(),
 UNIQUE(cliente_slug,clave),
 UNIQUE(cliente_slug,id),
 FOREIGN KEY(cliente_slug,fusionado_a) REFERENCES farmetrica.familias_globales(cliente_slug,id)
);
CREATE TABLE IF NOT EXISTS farmetrica.familias_globales_alias (
 cliente_slug text NOT NULL,
 farmacia_codigo text NOT NULL,
 codigo_origen text NOT NULL,
 familia_id bigint NOT NULL,
 nombre_origen text NOT NULL DEFAULT '',
 metodo text NOT NULL CHECK (metodo IN ('referencia','coincidencia_cn','sin_referencia','manual')),
 coincidencias integer NOT NULL DEFAULT 0 CHECK (coincidencias>=0),
 confianza numeric(6,5),
 actualizado_en timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(cliente_slug,farmacia_codigo,codigo_origen),
 FOREIGN KEY(cliente_slug,familia_id)
  REFERENCES farmetrica.familias_globales(cliente_slug,id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS familias_globales_alias_destino_idx
 ON farmetrica.familias_globales_alias(cliente_slug,familia_id);
-- Proyección de artículo ERP a familia global; se recalcula sin modificar ERP.
-- Un artículo sin evidencia puede quedar sin relación y se audita explícitamente.
CREATE TABLE IF NOT EXISTS farmetrica.familias_globales_articulos (
 cliente_slug text NOT NULL REFERENCES farmetrica.clientes(slug) ON DELETE CASCADE,
 farmacia_codigo text NOT NULL,
 articulo_origen_id text NOT NULL,
 familia_id bigint NOT NULL,
 metodo text NOT NULL CHECK (metodo IN ('referencia_cn','familia_local')),
 reconciliacion_id text NOT NULL DEFAULT '',
 actualizado_en timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(cliente_slug,farmacia_codigo,articulo_origen_id),
 FOREIGN KEY(cliente_slug,familia_id)
  REFERENCES farmetrica.familias_globales(cliente_slug,id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS familias_globales_articulos_destino_idx
 ON farmetrica.familias_globales_articulos(cliente_slug,familia_id);
