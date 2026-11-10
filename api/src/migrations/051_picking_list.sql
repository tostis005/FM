-- 051 · Picking List Shopify: snapshot CSV pendiente + fuente privada de Dropbox.
-- No altera ninguna venta, salida de almacén ni existencias Farmatic.
CREATE TABLE IF NOT EXISTS farmetrica.picking_list_fuentes (
 cliente_slug text PRIMARY KEY REFERENCES farmetrica.clientes(slug) ON DELETE CASCADE,
 csv_url text,
 ultimo_origen text,
 ultima_importacion timestamptz,
 ultima_fila integer NOT NULL DEFAULT 0,
 actualizado_por text,
 actualizado_en timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS farmetrica.picking_list_pendientes (
 cliente_slug text NOT NULL REFERENCES farmetrica.clientes(slug) ON DELETE CASCADE,
 linea integer NOT NULL,
 order_id text NOT NULL,
 order_name text NOT NULL DEFAULT '',
 order_created_at timestamptz,
 order_source_name text NOT NULL DEFAULT '',
 quantity integer NOT NULL CHECK(quantity>0 AND quantity<=50000),
 sku text NOT NULL,
 cn text,
 variant_id text NOT NULL DEFAULT '',
 title text NOT NULL DEFAULT '',
 importado_en timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(cliente_slug,linea)
);
CREATE INDEX IF NOT EXISTS picking_list_pendientes_cn_idx
 ON farmetrica.picking_list_pendientes(cliente_slug,cn);
CREATE INDEX IF NOT EXISTS picking_list_pendientes_canal_idx
 ON farmetrica.picking_list_pendientes(cliente_slug,order_source_name);

-- Registrar el estado de las lecturas automáticas, incluso entre reinicios de API.
-- Los errores no modifican ni borran el último snapshot válido.
ALTER TABLE farmetrica.picking_list_fuentes
 ADD COLUMN IF NOT EXISTS ultima_comprobacion timestamptz,
 ADD COLUMN IF NOT EXISTS ultimo_error text,
 ADD COLUMN IF NOT EXISTS ultima_advertencia text;

-- Conservar las filas completas descartadas por la importación para auditoría.
-- El informe las recupera por páginas y solo con permisos para Picking List.
ALTER TABLE farmetrica.picking_list_fuentes
 ADD COLUMN IF NOT EXISTS ultima_advertencia_detalle jsonb;
