-- Agenda de pedidos GLOBAL por laboratorio. Las farmacias son únicamente
-- puntos de stock/reparto, nunca unidades independientes de planificación.
-- Conserva intacto el historial legado por farmacia para auditoría.
CREATE TABLE IF NOT EXISTS farmetrica.preparador_pedidos_globales (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 cliente_slug text NOT NULL,
 laboratorio_id bigint NOT NULL,
 grupo_id uuid NOT NULL,
 fecha date NOT NULL,
 tipo text NOT NULL DEFAULT 'pedido' CHECK(tipo IN ('pedido','fecha_inicial')),
 confirmado_por text NOT NULL,
 confirmado_en timestamptz NOT NULL DEFAULT now(),
 anulado_por text,
 anulado_en timestamptz,
 FOREIGN KEY(cliente_slug,laboratorio_id)
  REFERENCES farmetrica.proveedores_unificados(cliente_slug,id),
 UNIQUE(cliente_slug,grupo_id)
);
CREATE INDEX IF NOT EXISTS preparador_globales_ultimos_idx
 ON farmetrica.preparador_pedidos_globales
 (cliente_slug,laboratorio_id,fecha DESC,confirmado_en DESC)
 WHERE anulado_en IS NULL;

-- Auditoría reversible de la asignación inicial. Aplicar una sola vez y
-- nunca reponer una frecuencia si después el administrador la cambia.
CREATE TABLE IF NOT EXISTS farmetrica.preparador_frecuencia_propuesta (
 cliente_slug text NOT NULL REFERENCES farmetrica.clientes(slug) ON DELETE CASCADE,
 laboratorio_id bigint NOT NULL,
 criterio text NOT NULL,
 cn_unicos integer NOT NULL,
 frecuencia_propuesta integer,
 frecuencia_anterior integer,
 aplicada boolean NOT NULL DEFAULT false,
 creado_en timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(cliente_slug,laboratorio_id,criterio),
 FOREIGN KEY(cliente_slug,laboratorio_id)
  REFERENCES farmetrica.proveedores_unificados(cliente_slug,id)
);
