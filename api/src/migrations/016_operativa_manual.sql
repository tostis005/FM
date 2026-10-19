-- FARMÉTRICA · Operativa manual multiempresa, sin dependencia del sincronizador.
-- Idempotente y aditiva; no modifica ventas, compras, farmacias ni inventarios.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS farmetrica.op_oportunidades (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 cliente_slug text NOT NULL,
 farmacia_id integer NOT NULL,
 regla text NOT NULL,
 episodio integer NOT NULL DEFAULT 1 CHECK (episodio>0),
 titulo text NOT NULL CHECK (length(titulo) BETWEEN 1 AND 180),
 descripcion text NOT NULL DEFAULT '',
 accion text NOT NULL DEFAULT '',
 prioridad text NOT NULL DEFAULT 'media' CHECK (prioridad IN ('critica','alta','media','baja')),
 estado text NOT NULL DEFAULT 'nueva' CHECK (estado IN ('nueva','en_estudio','en_curso','aplicada_parcialmente','aplicada','descartada','pospuesta')),
 impacto_tipo text NOT NULL DEFAULT 'ahorro_potencial' CHECK (impacto_tipo IN ('ahorro_potencial','mejora_margen','capital_liberable','riesgo')),
 importe_potencial numeric(16,2) NOT NULL DEFAULT 0 CHECK (importe_potencial>=0),
 metodo text NOT NULL DEFAULT '',
 periodo text NOT NULL DEFAULT '',
 confianza text NOT NULL DEFAULT 'sin_datos' CHECK (confianza IN ('sin_datos','baja','media','alta')),
 responsable text,
 creado_por text NOT NULL,
 creado_en timestamptz NOT NULL DEFAULT now(),
 actualizado_en timestamptz NOT NULL DEFAULT now(),
 resuelto_en timestamptz,
 revision integer NOT NULL DEFAULT 1,
 FOREIGN KEY (cliente_slug,farmacia_id) REFERENCES farmetrica.farmacias(cliente_slug,id),
 UNIQUE (cliente_slug,farmacia_id,regla,episodio)
);
CREATE UNIQUE INDEX IF NOT EXISTS op_oportunidades_un_episodio_abierto
 ON farmetrica.op_oportunidades(cliente_slug,farmacia_id,regla)
 WHERE estado NOT IN ('aplicada','descartada');
CREATE INDEX IF NOT EXISTS op_oportunidades_ambito ON farmetrica.op_oportunidades(cliente_slug,farmacia_id,estado,creado_en DESC);

CREATE TABLE IF NOT EXISTS farmetrica.op_pedidos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 cliente_slug text NOT NULL,
 farmacia_id integer NOT NULL,
 nombre text NOT NULL CHECK(length(nombre) BETWEEN 1 AND 180),
 estado text NOT NULL DEFAULT 'borrador'
  CHECK(estado IN ('borrador','pendiente_aprobacion','aprobado','exportado','cancelado')),
 lineas jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(lineas)='array'),
 creado_por text NOT NULL,
 aprobado_por text,
 aprobado_en timestamptz,
 creado_en timestamptz NOT NULL DEFAULT now(),
 actualizado_en timestamptz NOT NULL DEFAULT now(),
 revision integer NOT NULL DEFAULT 1,
 FOREIGN KEY (cliente_slug,farmacia_id) REFERENCES farmetrica.farmacias(cliente_slug,id)
);
CREATE INDEX IF NOT EXISTS op_pedidos_ambito ON farmetrica.op_pedidos(cliente_slug,farmacia_id,estado,actualizado_en DESC);

CREATE TABLE IF NOT EXISTS farmetrica.op_trabajo (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 cliente_slug text NOT NULL,
 farmacia_id integer NOT NULL,
 tipo text NOT NULL CHECK(tipo IN ('alerta','tarea','inventario','aprobacion')),
 titulo text NOT NULL CHECK(length(titulo) BETWEEN 1 AND 180),
 descripcion text NOT NULL DEFAULT '',
 estado text NOT NULL DEFAULT 'pendiente'
  CHECK(estado IN ('pendiente','en_curso','resuelta','descartada','pospuesta')),
 prioridad text NOT NULL DEFAULT 'media' CHECK(prioridad IN ('critica','alta','media','baja')),
 responsable text,
 fecha_limite timestamptz,
 creado_por text NOT NULL,
 creado_en timestamptz NOT NULL DEFAULT now(),
 actualizado_en timestamptz NOT NULL DEFAULT now(),
 revision integer NOT NULL DEFAULT 1,
 FOREIGN KEY (cliente_slug,farmacia_id) REFERENCES farmetrica.farmacias(cliente_slug,id)
);
CREATE INDEX IF NOT EXISTS op_trabajo_ambito ON farmetrica.op_trabajo(cliente_slug,farmacia_id,tipo,estado);

CREATE TABLE IF NOT EXISTS farmetrica.op_traspasos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 cliente_slug text NOT NULL,
 origen_farmacia_id integer NOT NULL,
 destino_farmacia_id integer NOT NULL,
 articulo text NOT NULL CHECK(length(articulo) BETWEEN 1 AND 120),
 descripcion text NOT NULL DEFAULT '',
 unidades integer NOT NULL CHECK(unidades>0),
 valor numeric(16,2) NOT NULL DEFAULT 0 CHECK(valor>=0),
 estado text NOT NULL DEFAULT 'propuesta' CHECK(estado IN ('propuesta','en_revision','aprobada','realizada','descartada')),
 notas text NOT NULL DEFAULT '',
 creado_por text NOT NULL,
 aprobado_por text,
 creado_en timestamptz NOT NULL DEFAULT now(),
 actualizado_en timestamptz NOT NULL DEFAULT now(),
 revision integer NOT NULL DEFAULT 1,
 CHECK(origen_farmacia_id <> destino_farmacia_id),
 FOREIGN KEY (cliente_slug,origen_farmacia_id) REFERENCES farmetrica.farmacias(cliente_slug,id),
 FOREIGN KEY (cliente_slug,destino_farmacia_id) REFERENCES farmetrica.farmacias(cliente_slug,id)
);
CREATE INDEX IF NOT EXISTS op_traspasos_origen ON farmetrica.op_traspasos(cliente_slug,origen_farmacia_id,estado);

CREATE TABLE IF NOT EXISTS farmetrica.op_politicas_reposicion (
 cliente_slug text NOT NULL,
 farmacia_id integer NOT NULL,
 cobertura_saludable integer NOT NULL DEFAULT 90 CHECK (cobertura_saludable>0),
 intervalo_pedidos integer NOT NULL DEFAULT 7 CHECK (intervalo_pedidos>0),
 plazo_entrega integer NOT NULL DEFAULT 2 CHECK (plazo_entrega>=0),
 stock_seguridad integer NOT NULL DEFAULT 0 CHECK (stock_seguridad>=0),
 actualizado_por text NOT NULL,
 actualizado_en timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(cliente_slug,farmacia_id),
 FOREIGN KEY (cliente_slug,farmacia_id) REFERENCES farmetrica.farmacias(cliente_slug,id)
);

CREATE TABLE IF NOT EXISTS farmetrica.op_eventos (
 id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
 cliente_slug text NOT NULL,
 farmacia_id integer NOT NULL,
 recurso text NOT NULL CHECK(recurso IN ('oportunidades','pedidos','trabajo','traspasos','politicas')),
 recurso_id text NOT NULL,
 evento text NOT NULL,
 detalles jsonb NOT NULL DEFAULT '{}'::jsonb,
 actor text NOT NULL,
 creado_en timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (cliente_slug,farmacia_id) REFERENCES farmetrica.farmacias(cliente_slug,id)
);
CREATE INDEX IF NOT EXISTS op_eventos_recurso ON farmetrica.op_eventos(cliente_slug,farmacia_id,recurso,recurso_id,creado_en DESC);

-- El ahorro verificado se incorporará por operaciones posteriores, con evidencia.
-- No se crea ninguna fila al marcar una oportunidad como aplicada.
CREATE TABLE IF NOT EXISTS farmetrica.op_resultados_verificados (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 cliente_slug text NOT NULL,
 farmacia_id integer NOT NULL,
 oportunidad_id uuid,
 tipo text NOT NULL CHECK (tipo IN ('ahorro_verificado','margen_verificado','capital_liberado')),
 importe numeric(16,2) NOT NULL CHECK(importe>=0),
 inicio_base date NOT NULL,
 fin_base date NOT NULL,
 inicio_comparacion date NOT NULL,
 fin_comparacion date NOT NULL,
 metodo text NOT NULL,
 evidencia text NOT NULL,
 clave_deduplicacion text NOT NULL,
 creado_en timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (cliente_slug,farmacia_id) REFERENCES farmetrica.farmacias(cliente_slug,id),
 FOREIGN KEY (oportunidad_id) REFERENCES farmetrica.op_oportunidades(id),
 UNIQUE(cliente_slug,farmacia_id,clave_deduplicacion)
);
CREATE INDEX IF NOT EXISTS op_resultados_ambito ON farmetrica.op_resultados_verificados(cliente_slug,farmacia_id,creado_en DESC);

-- El usuario navegador nunca tiene acceso SQL. Las APIs Express filtran siempre por tenant y farmacia.
