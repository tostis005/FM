-- Catálogo de presentaciones oficial AEMPS, común y solo de lectura para clientes.
-- Separado de datos operativos: cada farmacia sigue aislada en su esquema.
CREATE SCHEMA IF NOT EXISTS farmetrica;
CREATE TABLE IF NOT EXISTS farmetrica.nomenclator_versiones (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fuente text NOT NULL,
  sha256 text NOT NULL UNIQUE,
  fecha_fuente date,
  importado_en timestamptz NOT NULL DEFAULT now(),
  total_presentaciones integer NOT NULL CHECK(total_presentaciones>=0),
  total_genericos integer NOT NULL CHECK(total_genericos>=0),
  fichero text NOT NULL,
  activo boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX IF NOT EXISTS nomenclator_version_activa
  ON farmetrica.nomenclator_versiones (activo) WHERE activo;
CREATE TABLE IF NOT EXISTS farmetrica.nomenclator_presentaciones (
  cn text PRIMARY KEY CHECK(cn ~ '^[0-9]{6,7}$'),
  nombre text NOT NULL,
  laboratorio_codigo text,
  laboratorio text,
  principio_activo text,
  dcpf text NOT NULL,
  dcp text,
  dcsa text,
  generico boolean NOT NULL,
  comercializado boolean,
  actualizado_en timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS nomenclator_presentaciones_dcpf
 ON farmetrica.nomenclator_presentaciones(dcpf) WHERE generico;
CREATE INDEX IF NOT EXISTS nomenclator_presentaciones_dcp
 ON farmetrica.nomenclator_presentaciones(dcp) WHERE generico;
CREATE INDEX IF NOT EXISTS nomenclator_presentaciones_generico
 ON farmetrica.nomenclator_presentaciones(generico);
