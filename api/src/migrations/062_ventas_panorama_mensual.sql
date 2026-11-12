-- Resúmenes dimensionales de ventas, estrictamente históricos e inmutables.
-- Las categorías se resuelven en lectura: cambiar el maestro de familias
-- nunca necesita reescribir importes ni el artículo ERP del cierre.
CREATE TABLE IF NOT EXISTS farmetrica.ventas_panorama_mensual (
 cliente_slug text NOT NULL REFERENCES farmetrica.clientes(slug),
 farmacia_id integer NOT NULL REFERENCES farmetrica.farmacias(id),
 mes date NOT NULL CHECK(mes=date_trunc('month',mes)::date),
 dimension text NOT NULL CHECK(dimension IN ('articulo','vendedor','horario')),
 clave text NOT NULL,
 importe numeric NOT NULL DEFAULT 0,
 unidades numeric NOT NULL DEFAULT 0,
 lineas bigint NOT NULL DEFAULT 0,
 PRIMARY KEY(cliente_slug,farmacia_id,mes,dimension,clave)
);
CREATE INDEX IF NOT EXISTS fm_ventas_panorama_periodo_idx
 ON farmetrica.ventas_panorama_mensual(cliente_slug,mes,farmacia_id,dimension);
CREATE TABLE IF NOT EXISTS farmetrica.ventas_panorama_meses_cerrados (
 cliente_slug text NOT NULL REFERENCES farmetrica.clientes(slug),
 farmacia_id integer NOT NULL REFERENCES farmetrica.farmacias(id),
 mes date NOT NULL CHECK(mes=date_trunc('month',mes)::date),
 calculado_en timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(cliente_slug,farmacia_id,mes)
);
-- Proteger también el resumen de cada dimensión y el cierre, incluso si
-- otro código intentase escribir un ON CONFLICT DO UPDATE.
DO $$
DECLARE tabla text;
BEGIN
 FOREACH tabla IN ARRAY ARRAY['ventas_panorama_mensual','ventas_panorama_meses_cerrados'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_trigger
   WHERE tgrelid=to_regclass('farmetrica.'||tabla)
    AND tgname='fm_panorama_'||tabla||'_inmutable' AND NOT tgisinternal)
  THEN
   EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON farmetrica.%I '||
    'FOR EACH ROW EXECUTE FUNCTION farmetrica.prevent_report_consolidation_rewrite()',
    'fm_panorama_'||tabla||'_inmutable',tabla);
  END IF;
 END LOOP;
END $$;
