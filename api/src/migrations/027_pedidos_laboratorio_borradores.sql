-- Borradores de pedido por laboratorio. No envía pedidos al ERP.
CREATE TABLE IF NOT EXISTS farmetrica.pedidos_laboratorio_borradores (
 cliente_slug text NOT NULL REFERENCES farmetrica.clientes(slug) ON DELETE CASCADE,
 laboratorio_clave text NOT NULL,
 tipo text NOT NULL CHECK(tipo IN ('medicacion','parafarmacia')),
 farmacias_clave text NOT NULL,
 desde date NOT NULL,
 hasta date NOT NULL,
 lineas jsonb NOT NULL DEFAULT '[]'::jsonb,
 actualizado_en timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(cliente_slug,laboratorio_clave,tipo,farmacias_clave),
 CHECK(desde<=hasta),
 CHECK(jsonb_typeof(lineas)='array')
);
