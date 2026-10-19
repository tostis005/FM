# Ventas: separación de períodos, recuentos y familias por farmacia

## Lecturas independientes, siempre con el mismo período visible

- **Totales y gráfico** (`/api/analytics/ventas/totales`): período elegido por usuario (hoy, ayer, semanas, meses, 2/3/5 años, todo el histórico o fechas personalizadas), restringido a sus farmacias autorizadas.
- **Referencias por farmacia / artículos distintos** (`/api/analytics/ventas/recuento`): cuentan los artículos vendidos en **ese mismo rango seleccionado**, sin confundirlo con los meses configurados para el precálculo nocturno. El recuento sigue calculándose directamente sobre PostgreSQL.
- **Tabla Artículos** (`/api/analytics/ventas/detalle`): artículos vendidos exclusivamente en **el mismo período del filtro superior**, con todas sus cantidades, ingresos, PVP catálogo, precio real, coste y margen correspondientes al intervalo. Paginación SQL global de **400 artículos por bloque**, y **50 por página** visibles en interfaz.
- **ABCD de la tabla**: corresponde a ese período y farmacia. A/B/C dependen de los porcentajes de facturación acumulada, y D identifica referencias sin ventas cuando aparecen en un universo que las incluya. El 80 % de A es porcentaje del ingreso acumulado, no el 80 % de los productos.
- **Precálculo nocturno**: `farmetrica.ventas_analitica_cache` se genera por farmacia, cliente y la ventana de meses configurada por su administración (normalmente 12). Se usa solamente cuando las fechas solicitadas coinciden exactamente con esa ventana; en otros intervalos la consulta SQL calcula los datos correctos en vivo, **nunca sustituye el filtro del usuario**.
- **Carga web**: se muestra primero el total; la tabla y los recuentos tienen sus propios indicadores de carga. Cambiar fechas, farmacias, búsqueda o clasificación reinicia la paginación y descarta el detalle anterior.
- **Presentación**: fechas `dd/mm/aaaa`, miles con punto y decimales con coma; importes en euros siempre con dos decimales (también por unidad). Las cantidades vendidas se presentan con dos decimales sin modificar la precisión contable del origen.

## Familia no es una dimensión común de la red

Los campos `ampedia.articulos.familia` son códigos emitidos por cada ERP de farmacia. Una `familia='12'` en farmacia A no tiene por qué significar la misma agrupación que `familia='12'` en farmacia B.

Por eso el filtro y la columna familia del informe se muestran **solo para una farmacia**, y el endpoint `/api/analytics/ventas/familias` devuelve códigos acotados al ERP de esa farmacia. Mientras no se importen nombres, se presentan etiquetas neutrales (por ejemplo, «Familia 12»), **sin inventar** descripciones.

### Diseño propuesto de catálogo de nombres (siguiente fase cuando existan datos)

Importación por `(cliente_slug, farmacia_id, codigo_familia, nombre_familia)`; nunca por código de familia a nivel global. La fuente podrá ser CSV o la tabla de familias local de Farmatic, Nixfarma u otro ERP. Al importar, se debe comprobar que la farmacia pertenece al cliente, que los códigos corresponden a ese ERP y que las actualizaciones no mezclan registros de farmacias. Después, la API podrá mostrar `nombre_familia` sin sustituir el valor real `codigo_familia`, conservando trazabilidad y compatibilidad con los filtros guardados.

Por ahora **no hay tabla ni importación de nombres de familia realizada**. Se requiere su fuente para validar el mapeo.

## Pendiente fuera de la web

Se ha visto en producción `FarmetricaSync` reteniendo un `AccessExclusiveLock` sobre `ampedia.ventas` mientras está inactivo dentro de una transacción. Ese bloqueo invalida cualquier garantía de latencia, incluso para un `SUM` indexado. Código corregido y compilado en el proyecto Windows, pero es necesario instalar el nuevo ejecutable en el equipo que sincroniza: [issue #59](https://github.com/tostis005/FM/issues/59). No abortar ni matar una transacción activa sin coordinarlo.

## Configuración administrada

`farmetrica.clientes.analisis_abcd_meses` (3, 6, 12, 24 o 36, por defecto 12) define **la ventana precalculada nocturnamente**, no restringe el filtro de fechas de Ventas. El informe debe respetar siempre el rango escogido por el usuario, que puede no coincidir con esa ventana; si no coincide, consulta PostgreSQL para ese rango. La tabla de cache está separada de los artículos del ERP y se actualiza de forma transaccional. El recuento permanece sin caché.
