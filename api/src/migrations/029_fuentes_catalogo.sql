-- Histórico de cargas del catálogo de artículos/laboratorios externo.
-- El nomenclátor oficial mantiene su propia tabla nomenclator_versiones.
CREATE TABLE IF NOT EXISTS farmetrica.fuentes_catalogo_versiones (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 fuente text NOT NULL CHECK(fuente IN ('vademecum')),
 version text NOT NULL,
 sha256 text NOT NULL,
 archivo text NOT NULL,
 enlace_origen text,
 total_articulos integer NOT NULL CHECK(total_articulos>=0),
 cargado_por text NOT NULL,
 cargado_en timestamptz NOT NULL DEFAULT now(),
 activo boolean NOT NULL DEFAULT false,
 UNIQUE (fuente, sha256)
);
CREATE UNIQUE INDEX IF NOT EXISTS fuente_catalogo_version_activa
 ON farmetrica.fuentes_catalogo_versiones(fuente) WHERE activo=true;
