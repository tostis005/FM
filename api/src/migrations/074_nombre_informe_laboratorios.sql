-- Alias de presentación del informe, independiente de ERP y promociones.
DO $
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid='farmetrica.farmacias'::regclass AND attname='nombre_informe_laboratorios' AND NOT attisdropped) THEN
  ALTER TABLE farmetrica.farmacias ADD COLUMN nombre_informe_laboratorios text;
 END IF;
END $;

UPDATE farmetrica.farmacias
 SET nombre_informe_laboratorios='WAO',actualizado_en=now()
 WHERE cliente_slug='ampedia' AND coalesce(to_jsonb(farmacias)->>'tipo_establecimiento','farmacia')='almacen'
 AND upper(btrim(codigo_origen)) ='ALMACEN'
 AND nombre_informe_laboratorios IS NULL;
