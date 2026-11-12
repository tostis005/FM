-- 057 · Paleta azul agua para Farmacia Abadía (cliente ampedia).
-- Ajuste no destructivo, sólo sobre los colores de la semilla anterior.
-- No sobrescribir personalizaciones posteriores del administrador.
CREATE TABLE IF NOT EXISTS farmetrica.apariencia_ajustes_aplicados (
 clave text PRIMARY KEY,
 aplicado_en timestamptz NOT NULL DEFAULT now()
);

DO $fm$
BEGIN
 IF to_regclass('farmetrica.cliente_apariencia') IS NOT NULL
  AND EXISTS (
   SELECT 1 FROM information_schema.columns
   WHERE table_schema='farmetrica'
    AND table_name='cliente_apariencia' AND column_name='color_fondo'
  ) THEN
  WITH primera_aplicacion AS (
   INSERT INTO farmetrica.apariencia_ajustes_aplicados(clave)
   VALUES ('ampedia_paleta_agua_20261112')
   ON CONFLICT (clave) DO NOTHING
   RETURNING clave
  )
  UPDATE farmetrica.cliente_apariencia a
  SET color_secundario=CASE
       WHEN upper(a.color_secundario)='#145853' THEN '#286F7B'
       ELSE a.color_secundario END,
      color_fondo=CASE
       WHEN upper(a.color_fondo) IN ('#E8F3F1','#EFF8F6') THEN '#ECF6F7'
       ELSE a.color_fondo END,
      actualizado_en=now()
  FROM primera_aplicacion
  WHERE a.cliente_slug='ampedia'
   AND (upper(a.color_secundario)='#145853'
    OR upper(a.color_fondo) IN ('#E8F3F1','#EFF8F6'));
 END IF;
END $fm$;
