-- 064 · Registro del futuro despliegue por base de datos y variantes por cliente.
-- Aditiva: no mueve, renombra, publica ni copia datos de Ampedia.
-- NO almacenar contraseñas, DSN ni claves de conexión aquí.
CREATE TABLE IF NOT EXISTS farmetrica.cliente_despliegues (
 cliente_slug text PRIMARY KEY REFERENCES farmetrica.clientes(slug) ON DELETE CASCADE,
 almacenamiento text NOT NULL CHECK (almacenamiento IN ('esquema_heredado','base_independiente')),
 alias_conexion text,
 estado text NOT NULL DEFAULT 'planificado'
   CHECK (estado IN ('planificado','aprovisionando','validando','activo','suspendido','error')),
 actualizado_en timestamptz NOT NULL DEFAULT now(),
 CHECK (
   (almacenamiento='esquema_heredado' AND alias_conexion IS NULL)
   OR
   (almacenamiento='base_independiente'
    AND alias_conexion ~ '^[A-Z][A-Z0-9_]{2,63}$')
 )
);
COMMENT ON TABLE farmetrica.cliente_despliegues IS
 'Control plane: describe ubicación prevista; no redirige conexiones hasta implantar el router seguro. Los clientes sin fila siguen en esquema heredado.';

CREATE TABLE IF NOT EXISTS farmetrica.cliente_personalizaciones (
 cliente_slug text NOT NULL REFERENCES farmetrica.clientes(slug) ON DELETE CASCADE,
 funcionalidad text NOT NULL CHECK (funcionalidad ~ '^[a-z][a-z0-9_]{1,62}$'),
 variante text NOT NULL CHECK (variante ~ '^[a-z][a-z0-9_]{1,62}$'),
 parametros jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(parametros)='object'),
 actualizado_por text,
 actualizado_en timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(cliente_slug,funcionalidad)
);
COMMENT ON TABLE farmetrica.cliente_personalizaciones IS
 'Variantes futuras de interfaz/cálculo: no modifican módulos ni algoritmos hasta que cada funcionalidad las admita explícitamente.';

-- Una solicitud de demo NO es un tenant activo ni habilita acceso a datos.
-- La publicación exige auditoría de anonimización y BD aislada posterior.
CREATE TABLE IF NOT EXISTS farmetrica.demo_proyectos (
 slug text PRIMARY KEY CHECK (slug ~ '^[a-z][a-z0-9_]{1,62}$'),
 origen_slug text NOT NULL REFERENCES farmetrica.clientes(slug),
 nombre text NOT NULL CHECK (length(btrim(nombre)) BETWEEN 2 AND 150),
 alcance text NOT NULL CHECK (alcance IN ('multifarmacia','monofarmacia')),
 farmacia_origen_id integer,
 alias_conexion text NOT NULL CHECK (alias_conexion ~ '^[A-Z][A-Z0-9_]{2,63}$'),
 estado text NOT NULL DEFAULT 'planificado'
   CHECK (estado IN ('planificado','aprovisionando','validando','listo','error')),
 version_anonimizacion integer,
 auditoria_anonimizacion_aprobada boolean NOT NULL DEFAULT false,
 ultima_sincronizacion timestamptz,
 creado_en timestamptz NOT NULL DEFAULT now(),
 actualizado_en timestamptz NOT NULL DEFAULT now(),
 CHECK (
   (alcance='monofarmacia' AND farmacia_origen_id IS NOT NULL)
   OR
   (alcance='multifarmacia' AND farmacia_origen_id IS NULL)
 ),
 CHECK (estado <> 'listo' OR
  (auditoria_anonimizacion_aprobada AND coalesce(version_anonimizacion,0) >= 1
   AND ultima_sincronizacion IS NOT NULL)),
 UNIQUE(alias_conexion)
);
COMMENT ON TABLE farmetrica.demo_proyectos IS
 'Planificación únicamente. Ni esta tabla ni su estado listo autorizan por sí solos acceso a datos, usuarios o conexiones.';
