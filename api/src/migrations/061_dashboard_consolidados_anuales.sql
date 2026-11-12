-- Consolidación anual aditiva a partir de los meses documentales ya cerrados.
-- No lee de nuevo los ERP. Guardamos también los 12 meses para que los
-- gráficos mensuales mantengan exactamente su granularidad.
CREATE TABLE IF NOT EXISTS farmetrica.dashboard_consolidados_anuales (
 cliente_slug text NOT NULL REFERENCES farmetrica.clientes(slug),
 farmacia_id integer NOT NULL REFERENCES farmetrica.farmacias(id),
 anio integer NOT NULL CHECK(anio BETWEEN 1900 AND 2200),
 fuente text NOT NULL CHECK(fuente IN ('ventas','compras')),
 importe numeric NOT NULL DEFAULT 0,
 unidades numeric NOT NULL DEFAULT 0,
 documentos bigint NOT NULL DEFAULT 0,
 filas bigint NOT NULL DEFAULT 0,
 margen_coste numeric NOT NULL DEFAULT 0,
 meses jsonb NOT NULL CHECK(jsonb_typeof(meses)='array'),
 actualizado_en timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(cliente_slug,farmacia_id,anio,fuente),
 CHECK(jsonb_array_length(meses)=12)
);
CREATE INDEX IF NOT EXISTS fm_dashboard_anuales_periodo_idx
 ON farmetrica.dashboard_consolidados_anuales(cliente_slug,anio,fuente,farmacia_id);

-- Un snapshot cerrado es irreversible incluso ante ejecuciones antiguas,
-- sincronizaciones tardías o un INSERT ... ON CONFLICT DO UPDATE accidental.
CREATE OR REPLACE FUNCTION farmetrica.prevent_report_consolidation_rewrite()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'No se puede modificar un consolidado histórico permanente (%)',TG_TABLE_NAME;
END $$;
DO $$
DECLARE item text; trigger_name text;
BEGIN
 FOREACH item IN ARRAY ARRAY['dashboard_consolidados_mensuales',
                              'dashboard_consolidados_diarios',
                              'dashboard_consolidados_anuales'] LOOP
  trigger_name:='fm_'||item||'_inmutable';
  IF NOT EXISTS (
   SELECT 1 FROM pg_trigger t
   WHERE t.tgrelid=to_regclass('farmetrica.'||item)
    AND t.tgname=trigger_name AND NOT t.tgisinternal
  ) THEN
   EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON farmetrica.%I '||
     'FOR EACH ROW EXECUTE FUNCTION farmetrica.prevent_report_consolidation_rewrite()',
     trigger_name,item);
  END IF;
 END LOOP;
END $$;
