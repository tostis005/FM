-- Auditoría irreversible de fusiones explícitamente verificadas por productos.
-- Los IDs de origen se conservan inactivos con fusionado_a.
CREATE TABLE IF NOT EXISTS farmetrica.familias_globales_fusiones (
 cliente_slug text NOT NULL,
 familia_origen bigint NOT NULL,
 familia_destino bigint NOT NULL,
 nombre_origen text NOT NULL,
 nombre_destino text NOT NULL,
 nombre_normalizado text NOT NULL,
 cn_compartidos integer NOT NULL CHECK(cn_compartidos>=0),
 ratio_familia_menor numeric(8,5) NOT NULL CHECK(ratio_familia_menor>=0 AND ratio_familia_menor<=1),
 criterio text NOT NULL,
 aplicado_en timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(cliente_slug,familia_origen),
 FOREIGN KEY(cliente_slug,familia_origen)
  REFERENCES farmetrica.familias_globales(cliente_slug,id),
 FOREIGN KEY(cliente_slug,familia_destino)
  REFERENCES farmetrica.familias_globales(cliente_slug,id),
 CHECK(familia_origen<>familia_destino)
);
