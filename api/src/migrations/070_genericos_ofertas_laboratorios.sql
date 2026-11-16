-- Tarifas de laboratorios del cliente, conciliadas por CN con el Nomenclátor AEMPS.
-- Los precios comerciales nunca se almacenan en el catálogo global.
CREATE TABLE IF NOT EXISTS farmetrica.genericos_ofertas_laboratorios (
 cliente_slug text NOT NULL REFERENCES farmetrica.clientes(slug) ON DELETE CASCADE,
 laboratorio_fuente text NOT NULL,
 cn text NOT NULL CHECK(cn ~ '^[0-9]{6,7}$'),
 descripcion_excel text NOT NULL DEFAULT '',
 pvl numeric(14,6) NOT NULL CHECK(pvl>=0),
 descuento numeric(8,6) NOT NULL CHECK(descuento BETWEEN 0 AND 1),
 neto numeric(14,6) NOT NULL CHECK(neto>=0),
 iva numeric(8,6) NOT NULL CHECK(iva BETWEEN 0 AND 1),
 puc numeric(14,6) NOT NULL CHECK(puc>0),
 unidades_minimas integer,
 unidades_pack integer,
 unidades_caja integer,
 archivo_nombre text NOT NULL,
 importado_por text NOT NULL,
 importado_en timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(cliente_slug,laboratorio_fuente,cn)
);
CREATE INDEX IF NOT EXISTS genericos_ofertas_cn_idx
 ON farmetrica.genericos_ofertas_laboratorios(cliente_slug,cn);
CREATE TABLE IF NOT EXISTS farmetrica.genericos_objetivos_laboratorios (
 cliente_slug text NOT NULL REFERENCES farmetrica.clientes(slug) ON DELETE CASCADE,
 dcpf text NOT NULL,
 laboratorio_fuente text NOT NULL,
 cn text NOT NULL,
 porcentaje numeric(6,3) NOT NULL CHECK(porcentaje>0 AND porcentaje<=100),
 actualizado_por text NOT NULL,
 actualizado_en timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(cliente_slug,dcpf,laboratorio_fuente)
);
CREATE TABLE IF NOT EXISTS farmetrica.genericos_destinos_laboratorios (
 cliente_slug text NOT NULL REFERENCES farmetrica.clientes(slug) ON DELETE CASCADE,
 laboratorio_fuente text NOT NULL,
 proveedor_id bigint NOT NULL,
 actualizado_por text NOT NULL,
 actualizado_en timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(cliente_slug,laboratorio_fuente),
 FOREIGN KEY(cliente_slug,proveedor_id)
 REFERENCES farmetrica.proveedores_unificados(cliente_slug,id) ON DELETE CASCADE
);