# Mapeo de datos Farmatic → Farmétrica

Las vistas reales conocidas son `vLineaVenta`, `vRecep`, `vProveedor` y la tabla `Articu`, proporcionadas por el cliente. El SQL se preconfigura en el sincronizador, pero debe validarse en cada instalación antes de activarlo. Nunca se incluyen credenciales.

## Macro de acceso remoto

- En conexión directa, `{{TABLE:dbo.NombreTabla}}` se convierte a `[BaseDatos].[dbo].[NombreTabla]`.
- En conexión por Linked Server, se convierte a `[LinkedServer].[BaseDatosRemota].[dbo].[NombreTabla]`.
- Si los objetos reales tienen otros nombres o necesitan JOIN, se escriben consultas con varias macros de tabla.
- Los Linked Servers ya deben estar configurados y autenticados en el SQL Server central. El sincronizador **no crea** Linked Servers.

## Contratos mínimos

| Entidad | Columnas obligatorias en el SELECT | Otras columnas que debe devolver el SELECT |
|---|---|---|
| `ventas` | `origen_id` | `fecha`, `articulo_id`, `unidades`, `precio_unitario`, `importe`, `numero_ticket` |
| `compras` | `origen_id` | `fecha`, `articulo_id`, `proveedor_id`, `unidades`, `coste_unitario`, `importe` |
| `stock` | `origen_id` | `articulo_id`, `existencias`, `fecha_stock` |
| `articulos` | `origen_id` | `nombre`, `codigo_nacional`, `ean`, `familia`, `laboratorio`, `pvp` |
| `proveedores` | `origen_id` | `nombre`, `nif`, `telefono`, `email` |
| `vendedores` | `origen_id` | `nombre`, `tipo`, `color_ventas` |

**Todas** las columnas de una entidad deben devolverse en el SELECT, aunque puedan ser `NULL`. El motor añade `farmacia_codigo` y `sincronizado_en` automáticamente. `origen_id` debe ser estable, no nulo, único por farmacia y entidad (para líneas de ticket, identificar la línea, no solo la cabecera).

Ejemplo **estructural, no ejecutable tal cual**:

```sql
SELECT
  CAST(IdRealFila AS varchar(100)) AS origen_id,
  FechaReal AS fecha,
  CAST(CodigoRealArticulo AS varchar(100)) AS articulo_id,
  CAST(UnidadesReales AS decimal(18,4)) AS unidades,
  CAST(PrecioReal AS decimal(18,4)) AS precio_unitario,
  CAST(ImporteReal AS decimal(18,4)) AS importe,
  CAST(TicketReal AS varchar(100)) AS numero_ticket
FROM {{TABLE:dbo.TablaRealVentas}}
WHERE FechaRealModificacion > @desde
  AND FechaRealModificacion <= @hasta
```

## Incremental y snapshot

- **Incremental:** `@desde` y `@hasta` parametrizados (hora UTC). Solo es correcto si la tabla ofrece una **fecha real de última modificación** fiable, que también cambie en correcciones de operaciones antiguas. Después de confirmar la transacción PostgreSQL se guarda el punto de control. Existe un solapamiento de 180 minutos para relectura segura y upsert idempotente.
- **Snapshot:** se consultan todos los registros y, dentro de una misma transacción, se reemplazan solo los de la farmacia afectada. La carga aborta si devuelve cero filas o reduce más del 50% un conjunto existente de al menos 20 filas (protección anticorrupción). Recomendado inicialmente para stock y maestros si el volumen lo permite.
- **Borrados:** en incremental **no se detectan borrados físicos**. Para ello usar snapshot, fuente de tombstones, Change Tracking o CDC; pendiente de implementación por conector.
- **Volumen:** sin tope fijo total: lectura streaming con lotes de 100–20.000 filas y transacción PostgreSQL completa. Para una ejecución interrumpida, el siguiente intento reprocesa desde el checkpoint del trabajo; no retoma exactamente el bloque fallido.
- **Zona horaria:** se configura por farmacia (por defecto `Romance Standard Time` para España). Los límites `@desde` y `@hasta` se convierten a la hora local indicada. Los cambios de hora y los `datetime` SQL sin offset pueden generar ambigüedades; para garantías fuertes usar Change Tracking/CDC.
- **Fechas:** las columnas de negocio se almacenan como `timestamp without time zone`; en esta versión preservan el valor entregado por SQL Server. Acordar una zona horaria por farmacia antes de conectar países de zonas distintas.

## Validación necesaria antes de habilitar

1. Confirmar si Farmatic expone ventas por cabecera, líneas o movimientos; determinar una clave estable por fila.
2. Confirmar cómo se registran abonos, devoluciones, correcciones y borrados.
3. Revisar tipos decimales y si los importes incluyen impuestos, descuentos o devoluciones negativas.
4. Confirmar fecha/hora local y campo de modificación en cada tabla.
5. Verificar permisos sobre los objetos del Linked Server con la **identidad Windows real del servicio**.
6. Probar una ventana pequeña en una base PostgreSQL de preproducción y cuadrar ventas, compras y existencias.


### v0.4: contratos para tablas de solo altas

Las consultas incrementales deben devolver un `origen_id` estable y una **fecha de inserción/publicación**, no la fecha de la venta.
Usar un intervalo semiabierto y filtros inclusivos en el límite inferior:

```sql
SELECT IdLinea AS origen_id, FechaAlta AS fecha, /* otras columnas obligatorias */
FROM {{TABLE:dbo.LineasVenta}}
WHERE FechaAlta >= @desde AND FechaAlta < @hasta
```

La consulta es **ilustrativa**; adaptar nombres de tablas y columnas a la instalación Farmatic.
Confirmar si la FechaAlta queda fijada al insertar y cuál es el máximo retraso entre asignación, commit y visibilidad de filas.
No se puede garantizar ausencia de lagunas si se publican filas nuevas con fechas más antiguas que el solapamiento.
Proveedores, stock o catálogos con cambios y bajas usarán la política de carga completa.

## Plantilla verificada en conversación: Farmatic `dbo.vLineaVenta` (Abadía)

En `Consultas SQL`, seleccionar una farmacia con sistema `Farmatic` y la entidad `ventas`.
Las dos consultas aparecen ya precargadas en la interfaz; pueden modificarse.
Se incluyen `descuento_linea` = `DescuentoLinea` y
`descuento_operacion` = `DescuentoOpera`. No se suman ni transforman
porque debe validarse previamente si son importes o porcentajes.

La columna `farmacia` no debe devolverse por el SELECT:
PostgreSQL la genera a partir de `farmacia_codigo`, el código configurado de la farmacia.
También se aporta `sincronizado_en` automáticamente.

La conexión a SQL Server se puede probar antes de guardar la farmacia.
Para verificar el acceso real a `vLineaVenta`, guardar la farmacia y utilizar la
vista previa de la consulta con un intervalo de fechas; devuelve hasta 100 filas
y no escribe en destino. Ver `ABADIA_VENTAS_INCREMENTAL.sql`
y `ABADIA_VENTAS_COMPLETA.sql`.

**Atención a incrementales:** solo se puede garantizar continuidad por fecha si
`FechaHora` es estable y no se publican transacciones después del solapamiento de seguridad.
Los campos `IdVenta`, `IdNLinea` y `Empresa` se usan conjuntamente para la clave de fila.

## Nuevas plantillas v0.9: recepciones, stock, artículos y proveedores

Al crear **Consultas SQL** y elegir sistema Farmatic, las cuatro fuentes siguientes se preconfiguran con **Carga completa (snapshot)** como política predeterminada. Permiten comparar altas, cambios y bajas por farmacia. Los SELECT se pueden editar y restaurar desde la interfaz; los trabajos ya personalizados no se reemplazan.

| Entidad PostgreSQL | Origen Farmatic | Identificador | Campos seleccionados |
|---|---|---|---|
| `compras` | `dbo.vRecep` | `IdRecepcion` | `Fecha`, `Hora`, `XProv_IdProveedor`, `XCPro_IdCondicion`, `XVend_IdVendedor`, `Actualizado`, `Demorada`, `NPedido`, `IdAlbaran`, `FIS_NOMBRE`, `Descripcion` (sin `Descuento2`) |
| `articulos` | `dbo.Articu` | `IdArticu` | Catálogo y precios junto con `StockActual`, `StockMinimo`, `StockMaximo`, `LoteOptimo` |

| `proveedores` | `dbo.vProveedor` | `IDPROVEEDOR` | Datos fiscales: nombre, NIF, dirección, población, provincia, teléfono; código postal, web, descuento |

**Atención especial a compras:** `vRecep` contiene **solo cabeceras**. No ofrece identificador de artículo, unidades, precio de compra ni importe de línea. Por eso esas cuatro columnas se dejan a `NULL` en `farmetrica.compras`. **Una recepción no equivale a una línea de compra ni permite calcular gasto por artículo**. La fuente de detalle de recepciones deberá facilitarse para completar el módulo de compras sin mezclar niveles de detalle; no mostrar importes agregados de estas cabeceras como gasto real.

**Existencias dentro de artículos (desde v0.13):** `Articu.StockActual` se guarda como `articulos.stock_actual`. Los límites y lote óptimo pasan a `articulos.stock_minimo`, `articulos.stock_maximo` y `articulos.lote_optimo`. Son cantidades actuales, no movimientos ni históricos independientes. `sincronizado_en` indica el instante de la última sincronización de esa fila.

**Artículos:** `IdArticu` se usa como identificador de origen. `codigo_nacional` y `ean` se dejan `NULL` porque no hay columnas equivalentes en el SELECT facilitado; no deducirlos del ID interno.

**Proveedores:** se excluyen `CuentaBancoPago`, detalles personales `PER_*`, observaciones y campos sin utilidad analítica inmediata. Los descuentos se mantienen tal como los devuelve Farmatic sin asumir que sean euros o porcentajes. `email` se deja `NULL` porque no se proporcionó esa columna.

**Incrementales:** en v0.10 `vRecep` ofrece opcionalmente una consulta incremental basada en `Fecha` como fecha del documento, no fecha técnica de alta. La plantilla incorpora `WHERE r.Fecha >= CONVERT(date, @desde) AND r.Fecha < CONVERT(date, @hasta)`, leyendo **solo días completos**. `Hora` se importa como `hora_recepcion`, pero su tipo exacto no está verificado para crear un cursor por minuto. Por defecto se recomienda ejecutar el incremental **diariamente**, con **7 días de solapamiento**, en lugar de cada pocos minutos. **Advertencia:** una recepción nueva con una fecha anterior a esos 7 días puede omitirse; para garantizar integridad también se necesita una carga completa periódica de reconciliación o un campo de fecha de alta real. El archivo `FARMATIC_RECEPCIONES_INCREMENTAL.sql` contiene el SELECT para pegar en el sincronizador. `ventas` conserva su incremental `FechaHora`; el resto de maestros permanece en snapshot.

Los campos nuevos se añaden al contrato de PostgreSQL de forma aditiva. **Excepción expresamente solicitada en v0.12:** se elimina `descuento_recepcion` del contrato común. Para eliminarla también en PostgreSQL se requiere ejecutar la migración explícita desde la interfaz (o `MIGRAR_COMPRAS_ESQUEMA_COMUN.sql`) tras una copia de seguridad. Los SELECT antiguos de compras que hagan referencia a `Descuento2` deben actualizarse desde esquema antes de relanzarlos; no se reescriben automáticamente sin aprobación.

## Esquema común de compras v0.12 (cinco farmacias)

**No hay excepciones por farmacia.** ABA, BUE, EUR y las demás usan los mismos alias, el mismo SELECT completo y el mismo incremental (añadiendo solo el WHERE sobre `Fecha`). El SELECT ya no menciona `Descuento2`; no se guarda un equivalente ni siquiera a `NULL`: se elimina `descuento_recepcion` de la tabla con una migración explícita.

Columnas relevantes: `origen_id` (IdRecepcion), `fecha` (Fecha), `fecha_hora_recepcion` y `hora_recepcion` (Hora), `proveedor_id` (XProv_IdProveedor), `condicion_id` (XCPro_IdCondicion), `vendedor_id` (XVend_IdVendedor), `recepcion_actualizada` (Actualizado), `recepcion_demorada` (Demorada), `numero_pedido` (NPedido), `albaran_id` (IdAlbaran), `proveedor_nombre` (FIS_NOMBRE), `descripcion` (Descripcion). La farmacia se añade por su código configurado. Ejercicio y Mes derivan de la fecha, y NOMBRE repite la identificación del origen, por lo que no hace falta importarlos. Los campos de línea no disponibles siguen `NULL` hasta que se facilite el detalle real.

**Secuencia para los orígenes existentes:**

1. Esperar al fin de las cargas activas y respaldar `%ProgramData%\FarmetricaSync` y PostgreSQL.
2. En `/consultas` pulsar **Actualizar desde esquema (N consultas)** y confirmar. También es posible entrar en Editar y usar el botón individual.
3. Revisar **Ver primeros 100 · periódica** en todas las farmacias.
4. Pulsar **Actualizar tabla compras en PostgreSQL** y confirmar la retirada del descuento (se pierden sus valores antiguos).
5. Pulsar **Relanzar compras fallidas**. Solo se reencolan estados de error; no se relanza ABA si estaba correcto.

Los ID, historial y cursores no se reinician. Las consultas personalizadas de compras se reemplazan solamente tras confirmación expresa del usuario.

## v0.13: consolidación de existencias

Se retira la entidad de extracción independiente `stock`. Ahora **solo se ejecuta la consulta de `dbo.Articu`** para extraer catálogo y existencias; no hay que crear dos sincronizaciones por farmacia.

Al actualizar desde v0.12, los trabajos heredados de stock dejan de existir en el planificador. Los trabajos antiguos de artículos con la plantilla por defecto se actualizan solos; si se habían personalizado, se utiliza **Actualizar desde esquema** dentro de artículos. La primera carga correcta añade las columnas nuevas a PostgreSQL.

Para eliminar `farmetrica.stock` de forma segura, primero sincronizar **artículos de todas las farmacias**, y después usar la opción de retiro en Entidades de datos. La opción verifica que no falte ningún par `farmacia_codigo, origen_id` de la tabla stock original y que los cuatro valores coincidan; bloquea el `DROP TABLE ... RESTRICT` en caso contrario.

*El histórico de ejecución de stock anterior se mantiene para auditoría; su tabla física solo se retira tras la comprobación y confirmación.*

## Nueva fuente: Farmatic.dbo.Vendedor

Identificada con las columnas técnicas `IDVENDEDOR`, `NOMBRE`, `TIPO`
y `ColorVentas`. Se importa como catálogo completo (snapshot) diario,
no incremental, porque no hay campo de modificación. La identidad estable
es `(farmacia_codigo, IDVENDEDOR)`, no el nombre: nombres repetidos no
implican vendedores duplicados. El panel permite preparar una consulta
para cada farmacia en un clic, desactivada por seguridad.

```sql
SELECT
    CONVERT(varchar(100), v.IDVENDEDOR) AS origen_id,
    NULLIF(LTRIM(RTRIM(CONVERT(nvarchar(255), v.NOMBRE))), N'') AS nombre,
    NULLIF(LTRIM(RTRIM(CONVERT(nvarchar(40), v.TIPO))), N'') AS tipo,
    TRY_CONVERT(bigint, v.ColorVentas) AS color_ventas
FROM {{TABLE:dbo.Vendedor}} AS v
```

Se relaciona en ventas con `Venta.XVend_IdVendedor` y en recepciones
con `Recep.XVend_IdVendedor`. El color de Farmatic se conserva como
entero original, sin presuponer conversión RGB. No se publican datos
nominativos en el repositorio ni en la demo pública.
