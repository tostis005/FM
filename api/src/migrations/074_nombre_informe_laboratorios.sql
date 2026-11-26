-- Alias de presentación del informe, independiente de ERP y promociones.
ALTER TABLE farmetrica.farmacias
 ADD COLUMN IF NOT EXISTS nombre_informe_laboratorios text;

UPDATE farmetrica.farmacias
 SET nombre_informe_laboratorios='WAO',actualizado_en=now()
 WHERE cliente_slug='ampedia' AND tipo_establecimiento='almacen'
 AND upper(btrim(codigo_origen)) IN ('ALMACEN','AMP')
 AND nombre_informe_laboratorios IS NULL;
