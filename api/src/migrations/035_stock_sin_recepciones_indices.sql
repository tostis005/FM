-- 035 · Acelerar el listado de existencias actuales sin recepciones recientes.
-- El inventario se filtra por stock positivo; las líneas documentales
-- ya disponen de índices (farmacia_codigo, articulo_origen_id) en 016/019.
-- No se alteran datos ni se crea una materialización del histórico.
DO $$
DECLARE rec record; q text;
BEGIN
 FOR rec IN SELECT DISTINCT esquema_datos FROM farmetrica.clientes
   WHERE esquema_datos ~ '^[a-z][a-z0-9_]{1,62}$'
     AND to_regnamespace(esquema_datos) IS NOT NULL
 LOOP
  IF to_regclass(format('%I.articulos',rec.esquema_datos)) IS NULL THEN CONTINUE; END IF;
  -- Los clientes de demostración pueden exponer articulos como VISTA;
  -- PostgreSQL no admite índices sobre vistas normales.
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname=rec.esquema_datos AND c.relname='articulos'
      AND c.relkind IN ('r','p')
  ) THEN CONTINUE; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema=rec.esquema_datos AND table_name='articulos'
      AND column_name='stock_actual'
  ) THEN CONTINUE; END IF;
  q:=format('%I',rec.esquema_datos);
  EXECUTE format('CREATE INDEX IF NOT EXISTS articulos_stock_sin_recepciones_idx
    ON %s.articulos (upper(btrim(farmacia_codigo)),stock_actual DESC,origen_id)
    WHERE stock_actual>0',q);
 END LOOP;
END $$;
