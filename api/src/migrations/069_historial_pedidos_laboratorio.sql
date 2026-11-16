-- Historial inmutable de pedidos confirmados e importados, separado de borradores.
-- Se mantiene aislado por cliente y por las farmacias autorizadas de la sesión.
CREATE TABLE IF NOT EXISTS farmetrica.pedidos_laboratorio_historial (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 cliente_slug text NOT NULL REFERENCES farmetrica.clientes(slug) ON DELETE CASCADE,
 laboratorio_clave text NOT NULL,
 laboratorio_nombre text NOT NULL,
 tipo text NOT NULL CHECK(tipo IN ('medicacion','parafarmacia')),
 farmacias_clave text NOT NULL,
 fecha_pedido date NOT NULL,
 origen text NOT NULL CHECK(origen IN ('preparador','excel')),
 archivo_nombre text,
 realizado_por text NOT NULL,
 registrado_en timestamptz NOT NULL DEFAULT now(),
 grupo_agenda uuid,
 desde date,
 hasta date,
 lineas jsonb NOT NULL CHECK(jsonb_typeof(lineas)='array'),
 comentario_global text NOT NULL DEFAULT '',
 total_referencias integer NOT NULL CHECK(total_referencias BETWEEN 1 AND 5000),
 total_unidades bigint NOT NULL CHECK(total_unidades>0)
);
CREATE INDEX IF NOT EXISTS pedidos_laboratorio_historial_cliente_fecha_idx
 ON farmetrica.pedidos_laboratorio_historial(cliente_slug,fecha_pedido DESC,id DESC);
