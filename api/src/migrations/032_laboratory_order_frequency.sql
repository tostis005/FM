-- Período entre pedidos propio de cada laboratorio de cada cliente.
-- Nunca modifica la configuración de cobertura existente por farmacia.
CREATE TABLE IF NOT EXISTS farmetrica.preparador_frecuencia_laboratorio (
 cliente_slug text NOT NULL REFERENCES farmetrica.clientes(slug) ON DELETE CASCADE,
 laboratorio_clave text NOT NULL,
 intervalo_dias integer NOT NULL CHECK(intervalo_dias BETWEEN 1 AND 365),
 actualizado_en timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(cliente_slug,laboratorio_clave)
);
-- Las farmacias nuevas arrancan con 20 días de cobertura. No reescribir
-- las coberturas explícitamente configuradas por un administrador.
ALTER TABLE farmetrica.op_politicas_reposicion
 ALTER COLUMN cobertura_saludable SET DEFAULT 20;
