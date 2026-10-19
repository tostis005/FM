# Contrato único de JOIN: ventas completas y recepciones completas

Los dos nuevos tipos de trabajo del sincronizador son `ventas_completas` y
`recepciones_completas`. Cada trabajo recibe **un SELECT con JOIN (cabecera y
líneas)** y envía los datos de forma atómica a:

- `fm_ventas_cabeceras` + `fm_ventas_lineas`
- `fm_recepciones_cabeceras` + `fm_recepciones_lineas`

Estas tablas se crean con `api/src/migrations/016_modelo_documental.sql`.
Los informes actuales siguen leyendo las tablas anteriores `ventas`/`compras`
hasta validar el cambio de fuente. No se ejecuta ningún JOIN inventado de Farmatic.

## Alias del SELECT para cada flujo

**Todos los nombres indicados son nombres de salida (`AS alias`), no columnas
supuestas del ERP.** El lector exige que el SELECT incluya estos alias,
admitiendo valores `CAST(NULL AS ...)` cuando el origen no suministre el campo.

| Alias SQL normalizado | Uso |
|---|---|
| `origen_id` | Clave única de la fila extraída (documento y línea; cabecera sin línea con clave propia) |
| `documento_id` | Clave única del ticket/recepción dentro de farmacia y ERP |
| `linea_id` | Clave estable de línea dentro de documento; NULL para cabecera sin detalles |
| `fecha` | Fecha/hora comercial del documento |
| `numero_documento` | Número visible de ticket/albarán |
| `tercero_id` | Cliente de venta o proveedor de recepción |
| `empleado_id` | Usuario/vendedor, si existe y es apropiado |
| `estado` | Válido, anulado, devuelto, etc., según equivalencia explícita |
| `total_documento` | Importe de cabecera, una sola vez por documento |
| `descuento_global` | Descuento global de cabecera, sin repetir por cada línea |
| `descuento_global_tipo` | Importe, porcentaje o sin especificar |
| `impuestos_documento` | Importe fiscal total cuando existe |
| `modificado_origen` | Momento de última modificación relevante del documento |
| `articulo_id` | ID de artículo local a farmacia, nunca se supone que es CN |
| `unidades` | Cantidad firmada; negativa para devoluciones si el ERP la almacena así |
| `precio_unitario` | PVP o precio bruto de compra según tipo documental |
| `descuento_linea` | Descuento aplicado a la línea, sin sumar porcentajes e importes |
| `descuento_linea_tipo` | Importe, porcentaje o sin especificar |
| `importe_neto` | Importe neto de venta o coste neto de recepción |
| `impuesto_linea` | Impuestos asociados a la línea |
| `coste_historico` | Coste histórico de la venta, si consta |
| `bonificacion_unidades` | Bonificación física de recepción si consta |
| `numero_pedido` | Referencia del pedido origen en recepciones |
| `eliminado_logicamente` | Borrado lógico de la cabecera explícito |
| `linea_eliminada` | Borrado lógico explícito de línea |

La farmacia se asigna desde `Pharmacy.Code`, el sistema desde
`Pharmacy.SystemType` y el cliente desde el esquema de PostgreSQL configurado.
Estos datos no se aceptan desde la fila devuelta por el SELECT.

El motor conserva las fechas y los signos, valida que los JOIN no multipliquen
líneas, que las cabeceras sean coherentes y que no falten claves. Lee por lotes
acotados, prepara una tabla temporal privada y publica cabeceras/líneas en
una misma transacción PostgreSQL. El reintento usa UPSERT idempotente,
modificando solo los registros con diferencias. La carga completa no convierte
automáticamente documentos ausentes en eliminados: requiere un estado o
indicador explícito, para no inventar anulaciones.

## Incrementales que detectan cabeceras modificadas

Los filtros `@desde` y `@hasta` deben actuar sobre un campo o una estrategia
que detecte cambios tanto de cabecera como de línea (idealmente un
`ultima_modificacion_documento`). Filtrar exclusivamente por fecha comercial
puede omitir anulaciones y descuentos posteriores; cuando no haya campo fiable,
usar reconciliación completa periódica y ventana de repetición acordada.

## Estado actual y dependencias

- **Implementado en código:** entidades, migración aditiva, escritor JOIN,
  tratamiento de signos, transacciones, idempotencia y pruebas con PostgreSQL.
- **Fuentes Farmatic identificadas:** `dbo.Venta` + `dbo.LineaVenta`
  y `dbo.Recep` + `dbo.LINEARECEP`. Hay plantillas SELECT con JOIN para
  ambos flujos, disponibles al crear un trabajo nuevo, **desactivado por defecto**.
  Se han comprobado las columnas y muestras SSMS, no se ha ejecutado contra
  un servidor Farmatic conectado ni conciliado un periodo de explotación real.
- **Pendiente de reconciliación funcional:** demostrar igualdad con el ERP
  por documento, farmacia, periodo, unidades, importes, impuestos y devoluciones.
- **Compatibilidad:** los trabajos actuales `ventas`, `compras`, `articulos`,
  `familias` y `proveedores` permanecen intactos.

El coste neto de compras solo puede calcularse con importes y descuentos reales
de las líneas. Los descuentos globales permanecen en cabecera hasta fijar una
regla trazable de reparto; no se asignan automáticamente por conveniencia.

## Tablas y campos Farmatic identificados el 19/10/2026

**Tickets:** `Venta.IdVenta = LineaVenta.IdVenta`, línea
`LineaVenta.IdNLinea`. `Venta.Empresa` forma parte de la clave normalizada
de documento, aunque `LineaVenta` no contiene `Empresa`: se debe validar
que `IdVenta` es único entre empresas en cada instalación para que el JOIN
no duplique líneas. Se conserva `Venta.NumeroDoc` para presentación. El
importe final del documento es `Venta.TotalVenta`, el IVA conocido en
cabecera es `TotalCuota`, y el descuento de operación es
`Venta.DescuentoOpera`. `LineaVenta.ImporteNeto` incluye tanto
`LineaVenta.DescuentoLinea` como `LineaVenta.DescuentoOpera`.
No se vuelve a descontar de `ImporteNeto`.

En las **1.000 líneas de la muestra**, la relación
`ImporteBruto - DescuentoLinea - DescuentoOpera = ImporteNeto`
se cumple exactamente. Se conservan `Cantidad` e `ImporteNeto`
negativos para cambios/devoluciones. `TipoVenta` se persiste como
`tipo_venta:<valor_original>` en lugar de equiparar sin prueba
`C`/`R` a estados contables.

**Compras:** `Recep.IdRecepcion = LINEARECEP.IdRecepcion`; cada detalle
utiliza `LINEARECEP.IdNLinea` como clave de línea. El identificador local
de artículo se toma de `XArt_IdArticu`, el proveedor de
`Recep.XProv_IdProveedor` (se conservan ceros a la izquierda), las
unidades recibidas de `Recibidas`, el coste unitario observado de
`ImportePuc`, el importe de línea observado de `Importe` y las
bonificaciones de `UBonificar`. La muestra confirma en **1.000 líneas**
`Importe = Recibidas * ImportePuc`, sin diferencias en los valores
proporcionados. **Esta igualdad no demuestra si incluye IVA o descuentos**:
el campo normalizado `precio_unitario` proviene del PUC de origen,
y no debe describirse comercialmente como bruto verificado.

`Recep` **no contiene** `NPedido`, `IdAlbaran` ni total monetario.
El campo `LINEARECEP.XPed_IdPedido` pertenece a **cada línea**, no
a la cabecera, y solo se vinculará a pedidos cuando se valide la fuente
de pedidos. Los descuentos `Descuento1`, `Descuento2`,
`Descuento3`, `Descuento4`, `DtoManual`, `DFijo`,
`DtoBonif` y `descuentofijo` tienen significado financiero
pendiente de verificar. **No se suman ni se convierten en porcentajes por
suposición**: se usa `Importe` tal como viene; descuentos normalizados
y total de recepción permanecen `NULL` hasta la reconciliación.

`LINEARECEP.Baja` se conserva como indicador de baja lógica
**de línea**; `Modificada` es un indicador, no un instante
de cambio. La cabecera `Recep.Actualizado` tampoco se trata como
fecha de modificación. La fecha/hora de recepción se obtiene de
`Recep.Hora` cuando es una fecha-hora válida, con alternativa
`Recep.Fecha`. Los ejemplos recibidos tienen ambas fechas completas.

### Seguridad de las cargas y cambios pendientes

1. Los SELECT de ambas plantillas se ofrecen con JOIN `LEFT` para no
   perder cabeceras que carezcan de líneas visibles. El escritor
   comprueba claves únicas, consistencia entre filas y no publica
   resultados parciales ante errores.
2. El incremental de tickets usa `Venta.FechaHora`; el de
   recepciones filtra días completos de `Recep.Fecha`. Los
   datos **no** proporcionan una fecha técnica fiable de modificación
   de la cabecera y de sus líneas. Una rectificación muy tardía puede
   no detectarse: se propone relectura de 7 días y hay que programar
   además conciliaciones completas periódicas adecuadas al volumen real.
3. Las nuevas plantillas **no modifican automáticamente** los
   trabajos existentes `ventas` y `compras`. Se activan
   solo tras aplicar migración 016, comprobar permisos SELECT,
   comparar un periodo de prueba y revisar el plan de reconciliación.
4. Pendiente identificar CN/EAN verdaderos de `Articu` y las
   cabeceras/líneas de pedidos para reposición, así como semántica
   de descuentos, `TipoVenta`, y bajas/anulaciones de cabecera.
5. **Nunca subir registros de farmacia reales al repositorio público**.
   Guardar muestras y credenciales solo en un entorno de pruebas protegido.
