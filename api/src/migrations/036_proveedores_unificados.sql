-- Maestro único de proveedores Farmatic por cliente y origen local.
-- No modifica operaciones ni suprime proveedores históricos.
CREATE TABLE IF NOT EXISTS farmetrica.proveedores_unificados (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 cliente_slug text NOT NULL REFERENCES farmetrica.clientes(slug) ON DELETE CASCADE,
 clave_unificada text NOT NULL,
 nombre text NOT NULL,
 clase text NOT NULL DEFAULT 'SIN_CLASIFICAR'
  CHECK (clase IN ('DIRECTO','MAYORISTA','INTERNO','VACUNAS','FÓRMULAS','SIN_CLASIFICAR')),
 activo boolean NOT NULL DEFAULT true,
 actualizado_en timestamptz NOT NULL DEFAULT now(),
 UNIQUE(cliente_slug,clave_unificada),
 UNIQUE(cliente_slug,id)
);
CREATE TABLE IF NOT EXISTS farmetrica.proveedores_unificados_alias (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 cliente_slug text NOT NULL,
 proveedor_id bigint NOT NULL,
 farmacia_codigo text NOT NULL,
 codigo_origen text NOT NULL,
 nombre_origen text NOT NULL DEFAULT '',
 procedencia text NOT NULL DEFAULT 'farmatic'
  CHECK (procedencia IN ('farmatic','excel','manual')),
 vigencia text NOT NULL DEFAULT 'ACTUAL'
  CHECK (vigencia IN ('ACTUAL','ANTIGUO')),
 actualizado_en timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (cliente_slug,proveedor_id)
  REFERENCES farmetrica.proveedores_unificados(cliente_slug,id) ON DELETE CASCADE,
 UNIQUE(cliente_slug,farmacia_codigo,codigo_origen)
);
CREATE INDEX IF NOT EXISTS proveedores_unificados_clase_idx
 ON farmetrica.proveedores_unificados(cliente_slug,clase);
CREATE INDEX IF NOT EXISTS proveedores_unificados_alias_proveedor_idx
 ON farmetrica.proveedores_unificados_alias(cliente_slug,proveedor_id);
-- Los códigos de proveedor son locales a cada farmacia: NO se pueden
-- relacionar ni clasificar con una única clave codigo_origen global.
-- Los alias manuales prevalecen sobre nuevas importaciones, que deberán
-- mostrar posibles discrepancias para revisión.
-- INTERNO y MAYORISTA solo se excluyen del selector del preparador:
-- NUNCA se usan para eliminar movimientos de compras o ventas.
