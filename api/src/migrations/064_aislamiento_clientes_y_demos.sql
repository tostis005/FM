-- 064 · Base de configuración multi-cliente: variantes y ubicación futura.
-- ADITIVA. No mueve ni duplica ventas, compras, stock o documentos.
-- Todos los clientes existentes, incluidas las demos por vistas, conservan su esquema.
-- No guardar cadenas de conexión ni credenciales en el plano de configuración.
CREATE TABLE IF NOT EXISTS farmetrica.cliente_despliegues (
 cliente_slug text PRIMARY KEY REFERENCES farmetrica.clientes(slug) ON DELETE CASCADE,
 almacenamiento text NOT NULL CHECK(almacenamiento IN ('esquema_heredado','base_independiente')),
 alias_conexion text,
 estado text NOT NULL DEFAULT 'planificado'
  CHECK(estado IN ('planificado','aprovisionando','validando','activo','suspendido','error')),
 actualizado_en timestamptz NOT NULL DEFAULT now(),
 CHECK (
  (almacenamiento='esquema_heredado' AND alias_conexion IS NULL)
  OR
  (almacenamiento='base_independiente'
   AND alias_conexion ~ '^[A-Z][A-Z0-9_]{2,63}$')
 )
);
COMMENT ON TABLE farmetrica.cliente_despliegues IS
 'Ubicación futura de los datos. Sin fila se conserva ruta heredada. Esta tabla no activa por sí sola un router de bases.';

CREATE TABLE IF NOT EXISTS farmetrica.cliente_personalizaciones (
 cliente_slug text NOT NULL REFERENCES farmetrica.clientes(slug) ON DELETE CASCADE,
 funcionalidad text NOT NULL CHECK(funcionalidad ~ '^[a-z][a-z0-9_]{1,62}$'),
 variante text NOT NULL CHECK(variante ~ '^[a-z][a-z0-9_]{1,62}$'),
 parametros jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(parametros)='object'),
 actualizado_por text,
 actualizado_en timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(cliente_slug,funcionalidad)
);
COMMENT ON TABLE farmetrica.cliente_personalizaciones IS
 'Variantes configurables por cliente; los valores no alteran algoritmos hasta que cada módulo los soporte y valide.';

-- No se crea una segunda BD para las demos: ya existe
-- clientes.demo_origen_slug + vistas del esquema demo al esquema de origen.
-- Cada cliente tiene sus propias filas en farmetrica.farmacias,
-- farmetrica.cliente_apariencia y sus tablas de parámetros por cliente.
