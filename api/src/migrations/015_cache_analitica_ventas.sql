-- Precálculo de análisis de ventas por cliente, farmacia y ventana ABCD.
-- Nunca modificar las tablas importadas de los ERP. Los datos de origen
-- permanecen en sus propios esquemas. Reejecutable y aditivo.
CREATE TABLE IF NOT EXISTS farmetrica.ventas_analitica_cache (
 cliente_slug text NOT NULL REFERENCES farmetrica.clientes(slug) ON DELETE CASCADE,
 farmacia_id integer NOT NULL REFERENCES farmetrica.farmacias(id) ON DELETE CASCADE,
 analisis_meses integer NOT NULL CHECK(analisis_meses IN (3,6,12,24,36)),
 cn text NOT NULL,
 detalle jsonb NOT NULL,
 PRIMARY KEY(cliente_slug,farmacia_id,analisis_meses,cn)
);
CREATE INDEX IF NOT EXISTS fm_ventas_cache_valor_idx
 ON farmetrica.ventas_analitica_cache(cliente_slug,analisis_meses,((detalle->>'value')::double precision) DESC);
CREATE TABLE IF NOT EXISTS farmetrica.ventas_analitica_estado (
 cliente_slug text NOT NULL REFERENCES farmetrica.clientes(slug) ON DELETE CASCADE,
 farmacia_id integer NOT NULL REFERENCES farmetrica.farmacias(id) ON DELETE CASCADE,
 analisis_meses integer NOT NULL CHECK(analisis_meses IN (3,6,12,24,36)),
 desde date NOT NULL,
 hasta date NOT NULL,
 calculado_en timestamptz NOT NULL DEFAULT now(),
 referencias integer NOT NULL DEFAULT 0,
 PRIMARY KEY(cliente_slug,farmacia_id,analisis_meses)
);
