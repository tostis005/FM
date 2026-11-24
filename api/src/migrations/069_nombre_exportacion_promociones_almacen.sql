-- Nombre de presentación exclusivo para la exportación de promociones.
-- No modifica el nombre público, código ERP ni las ventas de farmacias.
ALTER TABLE farmetrica.farmacias
  ADD COLUMN IF NOT EXISTS nombre_exportacion_promociones TEXT;

-- Configuración inicial solicitada para el almacén de Ampedia.
-- Las ediciones posteriores no se sustituyen mientras conserven su valor.
UPDATE farmetrica.farmacias
SET nombre_exportacion_promociones='Ampedia Mercantil',actualizado_en=now()
WHERE cliente_slug='ampedia'
  AND coalesce(tipo_establecimiento,'farmacia')='almacen'
  AND nombre_exportacion_promociones IS NULL;
