# Ventas: separación de períodos, recuentos y familias por farmacia

## Lecturas independientes

- **Totales y gráfico** (`/api/analytics/ventas/totales`): el período seleccionado en Ventas puede ser hoy, hasta cinco años, todo el histórico o fechas personalizadas. SQL agregado directamente sobre `ventas` e índice por farmacia ERP y fecha. Para todo el histórico se representa el gráfico por años. La selección de farmacias respeta los permisos del usuario, y Valdemarías usa `VAL` aunque su código visible sea `POL`.
- **Productos por farmacia / artículos únicos** (`/api/analytics/ventas/recuento`): agregación exacta de referencias distintas en el período de análisis reciente (3, 6, 12, 24 o 36 meses, por defecto 12). Cada petición consulta directamente PostgreSQL. **No hay caché de recuentos**. Los meses se establecen a nivel de administrador en Ajustes y se validan en el servidor, no son un filtro del usuario.
- **Tabla de productos** (`/api/analytics/ventas/detalle`): paginación de 200 filas, clasificación ABCD a partir de las ventas de los meses definidos por administración (3/6/12/24/36) y márgenes aproximados con compras de **esa misma ventana**, solo para las referencias visibles. No recorre el período histórico elegido para el gráfico.
- **Carga web**: prioriza el total y gráfico; después arranca el recuento y la primera página de detalle simultáneamente. Ninguna de estas consultas utiliza caché de datos de negocio. Cambios de ámbito y fechas cancelan las peticiones anteriores. Las páginas siguientes se piden al pulsar «Cargar 200 artículos más».

## Familia no es una dimensión común de la red

Los campos `ampedia.articulos.familia` son códigos emitidos por cada ERP de farmacia. Una `familia='12'` en farmacia A no tiene por qué significar la misma agrupación que `familia='12'` en farmacia B.

Por eso el filtro y la columna familia del informe se muestran **solo para una farmacia**, y el endpoint `/api/analytics/ventas/familias` devuelve códigos acotados al ERP de esa farmacia. Mientras no se importen nombres, se presentan etiquetas neutrales (por ejemplo, «Familia 12»), **sin inventar** descripciones.

### Diseño propuesto de catálogo de nombres (siguiente fase cuando existan datos)

Importación por `(cliente_slug, farmacia_id, codigo_familia, nombre_familia)`; nunca por código de familia a nivel global. La fuente podrá ser CSV o la tabla de familias local de Farmatic, Nixfarma u otro ERP. Al importar, se debe comprobar que la farmacia pertenece al cliente, que los códigos corresponden a ese ERP y que las actualizaciones no mezclan registros de farmacias. Después, la API podrá mostrar `nombre_familia` sin sustituir el valor real `codigo_familia`, conservando trazabilidad y compatibilidad con los filtros guardados.

Por ahora **no hay tabla ni importación de nombres de familia realizada**. Se requiere su fuente para validar el mapeo.

## Pendiente fuera de la web

Se ha visto en producción `FarmetricaSync` reteniendo un `AccessExclusiveLock` sobre `ampedia.ventas` mientras está inactivo dentro de una transacción. Ese bloqueo invalida cualquier garantía de latencia, incluso para un `SUM` indexado. Código corregido y compilado en el proyecto Windows, pero es necesario instalar el nuevo ejecutable en el equipo que sincroniza: [issue #59](https://github.com/tostis005/FM/issues/59). No abortar ni matar una transacción activa sin coordinarlo.

## Configuración administrada

El período de análisis comercial se guarda en `farmetrica.clientes.analisis_abcd_meses` con valor por defecto **12**. Solo el rol `administrador` del cliente o `superadministrador` puede actualizarlo en Ajustes; un usuario no lo modifica con filtros ni modificando URLs. La migración aditiva `012_analisis_ventas_cliente.sql` garantiza el valor por defecto y restringe opciones a 3, 6, 12, 24 y 36 meses. El frontend obtiene el valor real del contexto del cliente y la API valida que el rango ABCD coincida con él. Los totales históricos continúan independientes.

**No hay caché de datos de ventas ni recuentos**; cada nueva solicitud lee PostgreSQL.
