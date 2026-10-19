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
- **Pendiente de consultas reales:** SELECT Farmatic que permita mapear
  cabeceras/líneas de tickets y recepciones, sus claves de relación y
  los criterios de modificación. No hay plantilla por defecto activada.
- **Pendiente de reconciliación funcional:** demostrar igualdad con el ERP
  por documento, farmacia, periodo, unidades, importes, impuestos y devoluciones.
- **Compatibilidad:** los trabajos actuales `ventas`, `compras`, `articulos`,
  `familias` y `proveedores` permanecen intactos.

El coste neto de compras solo puede calcularse con importes y descuentos reales
de las líneas. Los descuentos globales permanecen en cabecera hasta fijar una
regla trazable de reparto; no se asignan automáticamente por conveniencia.
