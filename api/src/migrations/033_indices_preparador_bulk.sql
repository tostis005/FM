-- 033 · Índices aditivos para el preparador de pedidos.
-- CN y documentos originales permanecen intactos; sin recalcular ventas.
-- Las consultas por todos los CN de un laboratorio filtran por farmacia,
-- producto y fecha; se evita recorrer todas las ventas por cada bloque.
DO $$
DECLARE rec record; q text;
BEGIN
 FOR rec IN SELECT DISTINCT esquema_datos FROM farmetrica.clientes
  WHERE esquema_datos ~ '^[a-z][a-z0-9_]{1,62}$'
   AND to_regnamespace(esquema_datos) IS NOT NULL
 LOOP
  q:=format('%I',rec.esquema_datos);
  IF to_regclass(format('%I.fm_ventas_lineas',rec.esquema_datos)) IS NOT NULL THEN
   EXECUTE format('CREATE INDEX IF NOT EXISTS fm_ventas_lin_producto_doc_bulk_idx
    ON %s.fm_ventas_lineas (farmacia_codigo,articulo_origen_id,sistema_origen,documento_id)
    INCLUDE (cantidad,devuelta) WHERE NOT eliminada_logicamente AND coalesce(anulada,false)=false',q);
  END IF;
  IF to_regclass(format('%I.fm_recepciones_cabeceras',rec.esquema_datos)) IS NOT NULL THEN
   EXECUTE format('CREATE INDEX IF NOT EXISTS fm_recep_cab_proveedor_bulk_idx
    ON %s.fm_recepciones_cabeceras (farmacia_codigo,proveedor_origen_id,sistema_origen,documento_id)
    WHERE lineas_completas AND NOT eliminada_logicamente',q);
  END IF;
  IF to_regclass(format('%I.articulos',rec.esquema_datos)) IS NOT NULL AND
   EXISTS(SELECT 1 FROM information_schema.columns
    WHERE table_schema=rec.esquema_datos AND table_name='articulos'
     AND column_name='codigo_nacional') THEN
   EXECUTE format('CREATE INDEX IF NOT EXISTS articulos_cn_por_farmacia_bulk_idx
    ON %s.articulos (upper(btrim(farmacia_codigo)),btrim(codigo_nacional))
    WHERE nullif(btrim(codigo_nacional),'''') IS NOT NULL',q);
  END IF;
 END LOOP;
END $$;
