-- Catálogo de artículos por laboratorio y correspondencias ERP, aditivo y por cliente.
-- CN/EAN como texto: nunca convertir identificadores a número.
CREATE TABLE IF NOT EXISTS farmetrica.articulos_laboratorio_maestro (
  codigo text NOT NULL,
  nombre text NOT NULL,
  tipo text NOT NULL CHECK(tipo IN ('medicacion','parafarmacia')),
  laboratorio_clave text NOT NULL,
  laboratorio_nombre text NOT NULL,
  fuente text NOT NULL DEFAULT 'manual',
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (codigo, laboratorio_clave, tipo),
  CHECK (length(btrim(codigo)) BETWEEN 1 AND 40),
  CHECK (length(btrim(laboratorio_clave)) BETWEEN 3 AND 220)
);
CREATE INDEX IF NOT EXISTS articulos_laboratorio_clave_tipo
 ON farmetrica.articulos_laboratorio_maestro(laboratorio_clave,tipo,codigo);

CREATE TABLE IF NOT EXISTS farmetrica.proveedores_laboratorios (
  cliente_slug text NOT NULL REFERENCES farmetrica.clientes(slug) ON DELETE CASCADE,
  farmacia_id integer NOT NULL,
  codigo_proveedor text NOT NULL,
  laboratorio_clave text NOT NULL,
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cliente_slug,farmacia_id,codigo_proveedor),
  FOREIGN KEY (cliente_slug,farmacia_id)
    REFERENCES farmetrica.farmacias(cliente_slug,id) ON DELETE CASCADE,
  CHECK (length(btrim(codigo_proveedor)) BETWEEN 1 AND 60),
  CHECK (length(btrim(laboratorio_clave)) BETWEEN 3 AND 220)
);
CREATE INDEX IF NOT EXISTS proveedores_laboratorios_lab
 ON farmetrica.proveedores_laboratorios(cliente_slug,laboratorio_clave,farmacia_id);
