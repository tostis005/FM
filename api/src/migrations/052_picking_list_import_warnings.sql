-- La fuente de pedidos de Dropbox es permanente. Registrar cuántas
-- líneas no preparables traía el último CSV válido para poder auditar
-- importaciones parciales sin exponer datos de clientes.
ALTER TABLE farmetrica.picking_list_fuentes
 ADD COLUMN IF NOT EXISTS lineas_omitidas integer NOT NULL DEFAULT 0,
 ADD COLUMN IF NOT EXISTS aviso_importacion text NOT NULL DEFAULT '',
 ADD COLUMN IF NOT EXISTS contenido_sha256 text;
