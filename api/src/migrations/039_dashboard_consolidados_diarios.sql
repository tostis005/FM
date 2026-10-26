-- Consolidados diarios para semana/mes cerrado y periodos recientes.
-- Se almacenan los mismos campos y reglas que los consolidados mensuales 038.
-- Nunca sustituyen movimientos históricos ni crean importes estimados.
CREATE TABLE IF NOT EXISTS farmetrica.dashboard_consolidados_diarios (
 cliente_slug text NOT NULL REFERENCES farmetrica.clientes(slug),
 farmacia_id integer NOT NULL REFERENCES farmetrica.farmacias(id),
 dia date NOT NULL,
 fuente text NOT NULL CHECK(fuente IN ('ventas','compras')),
 importe numeric NOT NULL DEFAULT 0,
 unidades numeric NOT NULL DEFAULT 0,
 filas bigint NOT NULL DEFAULT 0,
 filas_importe bigint NOT NULL DEFAULT 0,
 filas_unidades bigint NOT NULL DEFAULT 0,
 filas_producto bigint NOT NULL DEFAULT 0,
 documentos bigint NOT NULL DEFAULT 0,
 filas_coste bigint NOT NULL DEFAULT 0,
 ventas_con_coste numeric NOT NULL DEFAULT 0,
 margen_coste numeric NOT NULL DEFAULT 0,
 actualizado_en timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(cliente_slug,farmacia_id,dia,fuente)
);
CREATE INDEX IF NOT EXISTS fm_dashboard_consolidados_dia_idx
 ON farmetrica.dashboard_consolidados_diarios(cliente_slug,dia,fuente,farmacia_id);
