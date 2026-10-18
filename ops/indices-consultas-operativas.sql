-- Optimización independiente · Índices funcionales para filtros y joins de la API real de Farmétrica.
-- PRECONDICIÓN: las tablas ampedia.ventas/compras/articulos/proveedores existen.
-- Ejecutar FUERA DE TRANSACCIÓN: CREATE INDEX CONCURRENTLY no admite BEGIN.
-- La construcción concurrente permite continuar INSERT/UPDATE de sincronización.
-- IF NOT EXISTS vuelve idempotentes las ejecuciones sucesivas. El workflow
-- comprueba indisvalid / indisready al terminar y no silencia índices inválidos.

SET lock_timeout = '60s';
SET statement_timeout = '40min';

-- Dashboard, informes y detalle: códigos ERP normalizados + ventana de fecha.
CREATE INDEX CONCURRENTLY IF NOT EXISTS fm_ventas_codigo_fecha_idx
 ON ampedia.ventas ((upper(btrim(farmacia_codigo))), fecha DESC);

-- Cruce contra fichas originales. El índice anterior de PK sobre
-- (farmacia_codigo, origen_id) NO sirve para upper(btrim(farmacia_codigo)).
CREATE INDEX CONCURRENTLY IF NOT EXISTS fm_articulos_codigo_id_sync_idx
 ON ampedia.articulos ((upper(btrim(farmacia_codigo))), origen_id, sincronizado_en DESC);

-- Compras y comparativas DCPF por fecha y farmacia.
CREATE INDEX CONCURRENTLY IF NOT EXISTS fm_compras_codigo_fecha_idx
 ON ampedia.compras ((upper(btrim(farmacia_codigo))), fecha DESC);

-- Resolución de proveedor por código ERP y farmacia.
CREATE INDEX CONCURRENTLY IF NOT EXISTS fm_proveedores_codigo_id_sync_idx
 ON ampedia.proveedores ((upper(btrim(farmacia_codigo))), origen_id, sincronizado_en DESC);

-- Seguimiento de promociones, detalle de artículo y búsqueda por CN/ID ERP.
CREATE INDEX CONCURRENTLY IF NOT EXISTS fm_ventas_codigo_articulo_fecha_idx
 ON ampedia.ventas ((upper(btrim(farmacia_codigo))), (btrim(articulo_id)), fecha DESC);

-- Historial de compras por artículo para precio ponderado y percentiles.
CREATE INDEX CONCURRENTLY IF NOT EXISTS fm_compras_codigo_articulo_fecha_idx
 ON ampedia.compras ((upper(btrim(farmacia_codigo))), articulo_id, fecha DESC);

-- Recalcular estadísticas para que el planificador pueda usar las expresiones.
ANALYZE ampedia.ventas;
ANALYZE ampedia.compras;
ANALYZE ampedia.articulos;
ANALYZE ampedia.proveedores;
