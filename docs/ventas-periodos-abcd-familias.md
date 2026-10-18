# Ventas: separación de períodos, recuentos y familias por farmacia

## Lecturas independientes

- **Totales y gráfico** (`/api/analytics/ventas/totales`): el período seleccionado en Ventas puede ser hoy, hasta cinco años, todo el histórico o fechas personalizadas. SQL agregado directamente sobre `ventas` e índice por farmacia ERP y fecha. Para todo el histórico se representa el gráfico por años. La selección de farmacias respeta los permisos del usuario, y Valdemarías usa `VAL` aunque su código visible sea `POL`.
- **Productos por farmacia / artículos únicos** (`/api/analytics/ventas/recuento`): agregación exacta de referencias distintas en el período de análisis reciente (3, 6 o 12 meses, por defecto 12). La API evita recalcular solicitudes idénticas durante 60 segundos, con caché aislada por cliente, farmacias y fechas; `refrescar=1` fuerza su recomputación. La caché es solo de memoria del servidor.
- **Tabla de productos** (`/api/analytics/ventas/detalle`): paginación de 200 filas, clasificación ABCD a partir de las ventas de 3/6/12 meses y márgenes aproximados con compras de **esa misma ventana**, solo para las referencias visibles. No recorre el período histórico elegido para el gráfico.
- **Carga web**: prioriza el total y gráfico; después arranca el recuento y la primera página de detalle simultáneamente. Cambios de ámbito y fechas cancelan las peticiones anteriores. Las páginas siguientes se piden al pulsar «Cargar 200 artículos más».

## Familia no es una dimensión común de la red

Los campos `ampedia.articulos.familia` son códigos emitidos por cada ERP de farmacia. Una `familia='12'` en farmacia A no tiene por qué significar la misma agrupación que `familia='12'` en farmacia B.

Por eso el filtro y la columna familia del informe se muestran **solo para una farmacia**, y el endpoint `/api/analytics/ventas/familias` devuelve códigos acotados al ERP de esa farmacia. Mientras no se importen nombres, se presentan etiquetas neutrales (por ejemplo, «Familia 12»), **sin inventar** descripciones.

### Diseño propuesto de catálogo de nombres (siguiente fase cuando existan datos)

Importación por `(cliente_slug, farmacia_id, codigo_familia, nombre_familia)`; nunca por código de familia a nivel global. La fuente podrá ser CSV o la tabla de familias local de Farmatic, Nixfarma u otro ERP. Al importar, se debe comprobar que la farmacia pertenece al cliente, que los códigos corresponden a ese ERP y que las actualizaciones no mezclan registros de farmacias. Después, la API podrá mostrar `nombre_familia` sin sustituir el valor real `codigo_familia`, conservando trazabilidad y compatibilidad con los filtros guardados.

Por ahora **no hay tabla ni importación de nombres de familia realizada**. Se requiere su fuente para validar el mapeo.

## Pendiente fuera de la web

Se ha visto en producción `FarmetricaSync` reteniendo un `AccessExclusiveLock` sobre `ampedia.ventas` mientras está inactivo dentro de una transacción. Ese bloqueo invalida cualquier garantía de latencia, incluso para un `SUM` indexado. Código corregido y compilado en el proyecto Windows, pero es necesario instalar el nuevo ejecutable en el equipo que sincroniza: [issue #59](https://github.com/tostis005/FM/issues/59). No abortar ni matar una transacción activa sin coordinarlo.
