-- 034 · Claves exactas de artículo utilizadas por la matriz del preparador.
-- Complementa 033; ningún cambio sobre los valores ni el histórico.
DO $$
DECLARE rec record; q text;
BEGIN
 FOR rec IN SELECT DISTINCT esquema_datos FROM farmetrica.clientes
  WHERE esquema_datos ~ '^[a-z][a-z0-9_]{1,62}$'
   AND to_regnamespace(esquema_datos) IS NOT NULL LOOP
  q:=format('%I',rec.esquema_datos);
  IF to_regclass(format('%I.articulos',rec.esquema_datos)) IS NULL THEN CONTINUE; END IF;
  IF EXISTS(SELECT 1 FROM information_schema.columns WHERE
   table_schema=rec.esquema_datos AND table_name='articulos' AND column_name='origen_id') THEN
   EXECUTE format('CREATE INDEX IF NOT EXISTS articulos_farmacia_origen_preparador_idx
    ON %s.articulos (upper(btrim(farmacia_codigo)),(origen_id::text))',q);
  END IF;
  IF EXISTS(SELECT 1 FROM information_schema.columns WHERE
   table_schema=rec.esquema_datos AND table_name='articulos' AND column_name='cn_normalizado') THEN
   EXECUTE format('CREATE INDEX IF NOT EXISTS articulos_farmacia_cn_norm_preparador_idx
    ON %s.articulos (upper(btrim(farmacia_codigo)),nullif(btrim(cn_normalizado),''''))
    WHERE nullif(btrim(cn_normalizado),'''') IS NOT NULL',q);
  END IF;
 END LOOP;
END $$;
