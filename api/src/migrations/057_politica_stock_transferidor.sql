-- Política independiente del preparador: 30 días de compra NO gobiernan transferencias.
CREATE TABLE IF NOT EXISTS farmetrica.transferidor_configuracion_cliente (
 cliente_slug text PRIMARY KEY REFERENCES farmetrica.clientes(slug) ON DELETE CASCADE,
 minimo_dias integer NOT NULL DEFAULT 4 CHECK (minimo_dias BETWEEN 1 AND 365),
 objetivo_dias integer NOT NULL DEFAULT 7 CHECK (objetivo_dias BETWEEN 1 AND 365),
 actualizado_por text NOT NULL DEFAULT 'sistema',
 actualizado_en timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT transferidor_objetivo_mayor_minimo_ck CHECK(objetivo_dias > minimo_dias)
);
-- Los días de exposición se SUMAN a los días de rotación (4 / 7).
CREATE TABLE IF NOT EXISTS farmetrica.transferidor_exposicion_familias (
 cliente_slug text NOT NULL,
 farmacia_id integer NOT NULL,
 familia_id bigint NOT NULL,
 exposicion_dias integer NOT NULL CHECK(exposicion_dias BETWEEN 1 AND 365),
 actualizado_por text NOT NULL DEFAULT 'sistema',
 actualizado_en timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(cliente_slug,farmacia_id,familia_id),
 FOREIGN KEY(cliente_slug,farmacia_id) REFERENCES farmetrica.farmacias(cliente_slug,id) ON DELETE CASCADE,
 FOREIGN KEY(cliente_slug,familia_id) REFERENCES farmetrica.familias_globales(cliente_slug,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS transferidor_exposicion_familias_familia_idx
 ON farmetrica.transferidor_exposicion_familias(cliente_slug,familia_id);
-- Exposición de un CN particular: reemplaza la reserva de familia en esa farmacia,
-- NO modifica el componente de rotación 4/7.
CREATE TABLE IF NOT EXISTS farmetrica.transferidor_exposicion_articulos (
 cliente_slug text NOT NULL,
 farmacia_id integer NOT NULL,
 codigo_nacional text NOT NULL CHECK(codigo_nacional ~ '^[0-9]{6}$'),
 exposicion_unidades integer NOT NULL CHECK(exposicion_unidades BETWEEN 1 AND 999999),
 actualizado_por text NOT NULL DEFAULT 'sistema',
 actualizado_en timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(cliente_slug,farmacia_id,codigo_nacional),
 FOREIGN KEY(cliente_slug,farmacia_id) REFERENCES farmetrica.farmacias(cliente_slug,id) ON DELETE CASCADE
);
