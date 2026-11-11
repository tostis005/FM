-- 056 · Ajuste único de la paleta del cliente Farmacia Abadía.
-- Fondo verde azulado suave que armoniza con el primario #087F79 del logo.
-- La marca se aplica una sola vez; los cambios posteriores desde Administración
-- > Clientes prevalecen y no se revierten en próximos despliegues.
CREATE TABLE IF NOT EXISTS farmetrica.apariencia_ajustes_aplicados (
  clave text PRIMARY KEY,
  aplicado_en timestamptz NOT NULL DEFAULT now()
);

-- La apariencia puede no estar instalada aún en entornos nuevos.
-- El marcador se escribe únicamente cuando existe el campo de destino.
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
    VALUES ('ampedia_fondo_teal_20261111')
    ON CONFLICT (clave) DO NOTHING
    RETURNING clave
  )
  UPDATE farmetrica.cliente_apariencia a
  SET color_fondo='#E8F3F1', actualizado_en=now()
  FROM primera_aplicacion
  WHERE a.cliente_slug='ampedia';
 END IF;
END $fm$;
