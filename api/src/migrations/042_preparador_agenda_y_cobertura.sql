-- Configuración centralizada y agenda por farmacia del preparador de pedidos.
-- No se modifican recepciones, pedidos ERP ni el histórico de movimientos.
CREATE TABLE IF NOT EXISTS farmetrica.preparador_configuracion_cliente (
 cliente_slug text PRIMARY KEY REFERENCES farmetrica.clientes(slug) ON DELETE CASCADE,
 cobertura_dias integer NOT NULL DEFAULT 20 CHECK(cobertura_dias BETWEEN 1 AND 365),
 actualizado_por text NOT NULL DEFAULT 'sistema',
 actualizado_en timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE farmetrica.proveedores_unificados
 ADD COLUMN IF NOT EXISTS fusionado_a bigint;
CREATE TABLE IF NOT EXISTS farmetrica.preparador_pedidos_realizados (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 cliente_slug text NOT NULL,
 laboratorio_id bigint NOT NULL,
 farmacia_id integer NOT NULL,
 grupo_id uuid NOT NULL,
 fecha date NOT NULL,
 tipo text NOT NULL DEFAULT 'pedido' CHECK(tipo IN ('pedido','fecha_inicial')),
 confirmado_por text NOT NULL,
 confirmado_en timestamptz NOT NULL DEFAULT now(),
 anulado_por text,
 anulado_en timestamptz,
 FOREIGN KEY (cliente_slug,laboratorio_id)
  REFERENCES farmetrica.proveedores_unificados(cliente_slug,id),
 FOREIGN KEY (cliente_slug,farmacia_id)
  REFERENCES farmetrica.farmacias(cliente_slug,id),
 UNIQUE(cliente_slug,grupo_id,farmacia_id)
);
CREATE INDEX IF NOT EXISTS preparador_pedidos_ultimos_idx
 ON farmetrica.preparador_pedidos_realizados(cliente_slug,laboratorio_id,farmacia_id,fecha DESC,confirmado_en DESC)
 WHERE anulado_en IS NULL;
CREATE INDEX IF NOT EXISTS preparador_pedidos_grupo_idx
 ON farmetrica.preparador_pedidos_realizados(cliente_slug,grupo_id);
