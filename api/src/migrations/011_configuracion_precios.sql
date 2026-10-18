-- Política de precios de referencia para análisis comercial (no modifica compras).
-- scope farmacia NULL -> valores globales para cliente; entero -> excepción local.
CREATE TABLE IF NOT EXISTS farmetrica.politica_precios (
  cliente_slug text NOT NULL REFERENCES farmetrica.clientes(slug) ON DELETE CASCADE,
  farmacia_id integer NOT NULL DEFAULT 0,
  percentil integer NOT NULL DEFAULT 20 CHECK(percentil IN (10,20,25,30,40,50)),
  meses integer NOT NULL DEFAULT 6 CHECK(meses IN (3,6,12)),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_por text,
  PRIMARY KEY(cliente_slug,farmacia_id)
);
INSERT INTO farmetrica.politica_precios(cliente_slug,farmacia_id,percentil,meses)
SELECT slug,0,20,6 FROM farmetrica.clientes
ON CONFLICT(cliente_slug,farmacia_id) DO NOTHING;
CREATE INDEX IF NOT EXISTS politica_precios_cliente ON farmetrica.politica_precios(cliente_slug);
