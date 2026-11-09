-- Gestión documental y contactos compartidos por cliente y proveedor definitivo.
-- No altera la tabla ERP ni los movimientos históricos de Farmatic.
CREATE TABLE IF NOT EXISTS farmetrica.proveedor_fichas (
 cliente_slug text NOT NULL REFERENCES farmetrica.clientes(slug) ON DELETE CASCADE,
 proveedor_id bigint NOT NULL,
 datos jsonb NOT NULL DEFAULT '{}'::jsonb,
 actualizado_en timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(cliente_slug,proveedor_id),
 FOREIGN KEY(cliente_slug,proveedor_id) REFERENCES
   farmetrica.proveedores_unificados(cliente_slug,id) ON DELETE CASCADE,
 CHECK (jsonb_typeof(datos)='object')
);
CREATE TABLE IF NOT EXISTS farmetrica.proveedor_contactos (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 cliente_slug text NOT NULL REFERENCES farmetrica.clientes(slug) ON DELETE CASCADE,
 proveedor_id bigint NOT NULL,
 nombre text NOT NULL,
 apellidos text NOT NULL DEFAULT '',
 cargo text NOT NULL DEFAULT '',
 email text NOT NULL DEFAULT '',
 telefono text NOT NULL DEFAULT '',
 notas text NOT NULL DEFAULT '',
 principal boolean NOT NULL DEFAULT false,
 creado_en timestamptz NOT NULL DEFAULT now(),
 actualizado_en timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(cliente_slug,proveedor_id) REFERENCES
   farmetrica.proveedores_unificados(cliente_slug,id) ON DELETE CASCADE,
 UNIQUE(cliente_slug,id)
);
CREATE INDEX IF NOT EXISTS proveedor_contactos_busqueda_idx
 ON farmetrica.proveedor_contactos(cliente_slug,proveedor_id,nombre);
CREATE UNIQUE INDEX IF NOT EXISTS proveedor_contactos_principal_idx
 ON farmetrica.proveedor_contactos(cliente_slug,proveedor_id) WHERE principal;

CREATE TABLE IF NOT EXISTS farmetrica.proveedor_documento_categorias (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 cliente_slug text NOT NULL REFERENCES farmetrica.clientes(slug) ON DELETE CASCADE,
 nombre text NOT NULL,
 activo boolean NOT NULL DEFAULT true,
 creado_en timestamptz NOT NULL DEFAULT now(),
 UNIQUE(cliente_slug,id),
 CHECK (char_length(btrim(nombre)) BETWEEN 2 AND 80)
);
CREATE UNIQUE INDEX IF NOT EXISTS proveedor_documento_categorias_nombre_idx
 ON farmetrica.proveedor_documento_categorias(cliente_slug,lower(btrim(nombre)));
INSERT INTO farmetrica.proveedor_documento_categorias(cliente_slug,nombre)
 SELECT 'ampedia',category
 FROM unnest(ARRAY['Tarifas','Condiciones comerciales','Vademécum','Promociones','Otros']) AS category
 WHERE EXISTS (SELECT 1 FROM farmetrica.clientes WHERE slug='ampedia')
 ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS farmetrica.proveedor_documentos (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 cliente_slug text NOT NULL REFERENCES farmetrica.clientes(slug) ON DELETE CASCADE,
 proveedor_id bigint NOT NULL,
 categoria_id bigint NOT NULL,
 nombre text NOT NULL,
 nombre_archivo text NOT NULL,
 tipo_mime text NOT NULL DEFAULT 'application/octet-stream',
 version text NOT NULL DEFAULT '',
 fecha_documento date,
 notas text NOT NULL DEFAULT '',
 archivo bytea NOT NULL,
 tamano integer NOT NULL CHECK (tamano > 0 AND tamano <= 15728640),
 creado_en timestamptz NOT NULL DEFAULT now(),
 actualizado_en timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(cliente_slug,proveedor_id) REFERENCES
   farmetrica.proveedores_unificados(cliente_slug,id) ON DELETE CASCADE,
 FOREIGN KEY(cliente_slug,categoria_id) REFERENCES
   farmetrica.proveedor_documento_categorias(cliente_slug,id)
);
CREATE INDEX IF NOT EXISTS proveedor_documentos_ficha_idx
 ON farmetrica.proveedor_documentos(cliente_slug,proveedor_id,creado_en DESC);
CREATE INDEX IF NOT EXISTS proveedor_documentos_categoria_idx
 ON farmetrica.proveedor_documentos(cliente_slug,categoria_id,fecha_documento DESC);
