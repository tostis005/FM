-- Consolidados mensuales por farmacia y fuente documental.
-- Solo resumenes; nunca copia líneas, datos personales ni catálogo.
-- La pareja fuente/mes permite detectar periodos no calculados: no se
-- presentan ceros inventados cuando una consolidación aún no existe.
CREATE TABLE IF NOT EXISTS farmetrica.dashboard_consolidados_mensuales (
 cliente_slug text NOT NULL REFERENCES farmetrica.clientes(slug),
 farmacia_id integer NOT NULL REFERENCES farmetrica.farmacias(id),
 mes date NOT NULL,
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
 PRIMARY KEY(cliente_slug,farmacia_id,mes,fuente),
 CHECK(mes=date_trunc('month',mes)::date)
);
CREATE INDEX IF NOT EXISTS fm_dashboard_consolidados_mes_idx
 ON farmetrica.dashboard_consolidados_mensuales(cliente_slug,mes,fuente,farmacia_id);
