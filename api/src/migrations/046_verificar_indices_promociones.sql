-- No marcar despliegue correcto si falta un índice válido y utilizable.
DO $$
DECLARE item record; missing text;
BEGIN
 FOR item IN
  SELECT c.esquema_datos AS esquema
  FROM farmetrica.clientes c
  JOIN pg_namespace n ON n.nspname=c.esquema_datos
  JOIN pg_class t ON t.relnamespace=n.oid AND t.relname='articulos'
    AND t.relkind IN ('r','p')
  WHERE c.esquema_datos ~ '^[a-z][a-z0-9_]{1,62}$'
    AND (SELECT count(DISTINCT x.column_name)
         FROM information_schema.columns x
         WHERE x.table_schema=c.esquema_datos AND x.table_name='articulos'
           AND x.column_name IN ('farmacia_codigo','origen_id','nombre',
                                 'codigo_nacional'))=4
 LOOP
  SELECT string_agg(expected.name,', ' ORDER BY expected.name) INTO missing
  FROM (VALUES
   ('promocion_articulos_texto_trgm_idx'),
   ('promocion_articulos_id_idx'),
   ('promocion_articulos_cn_idx')
  ) expected(name)
  WHERE NOT EXISTS (
   SELECT 1 FROM pg_index ix
   JOIN pg_class index_class ON index_class.oid=ix.indexrelid
   JOIN pg_class table_class ON table_class.oid=ix.indrelid
   JOIN pg_namespace ns ON ns.oid=table_class.relnamespace
   WHERE ns.nspname=item.esquema AND table_class.relname='articulos'
     AND index_class.relname=expected.name AND ix.indisvalid AND ix.indisready
  );
  IF missing IS NOT NULL THEN
   RAISE EXCEPTION 'Faltan índices Farmatic válidos en %: %',item.esquema,missing;
  END IF;
 END LOOP;
END $$;
