-- 012 · Corrige la correspondencia real de Valdemarías.
-- Los movimientos sincronizados de ventas, artículos y proveedores utilizan VAL,
-- mientras que el maestro inicial conservaba el código provisional POL.
-- No modifica operaciones, solo el mapeo de la farmacia 5 del cliente Ampedia.
DO $migration$
BEGIN
  IF NOT EXISTS (
     SELECT 1 FROM farmetrica.farmacias
      WHERE cliente_slug='ampedia' AND id=5
       AND upper(btrim(codigo_origen)) IN ('POL','VAL')
  ) THEN
    RAISE EXCEPTION 'Valdemarías: maestro inesperado, no se actualiza el código sin revisión';
  END IF;
  IF EXISTS (
     SELECT 1 FROM farmetrica.farmacias
      WHERE cliente_slug='ampedia' AND id<>5
       AND upper(btrim(codigo_origen))='VAL'
  ) THEN
    RAISE EXCEPTION 'VAL ya pertenece a otra farmacia del cliente';
  END IF;
  UPDATE farmetrica.farmacias SET codigo_origen='VAL',actualizado_en=now()
   WHERE cliente_slug='ampedia' AND id=5 AND codigo_origen='POL';
  -- Compatibilidad con los endpoints heredados que utilizan public.farmacias.
  IF EXISTS (
    SELECT 1 FROM public.farmacias WHERE id=5
      AND upper(btrim(codigo_origen)) NOT IN ('POL','VAL')
  ) THEN
    RAISE EXCEPTION 'El maestro público de Valdemarías no tiene el código previsto';
  END IF;
  UPDATE public.farmacias SET codigo_origen='VAL',actualizado_en=now()
   WHERE id=5 AND codigo_origen='POL';
END $migration$;
