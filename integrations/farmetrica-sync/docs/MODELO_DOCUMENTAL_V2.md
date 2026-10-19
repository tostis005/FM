# Contrato documental — ventas y recepciones (fase previa al mapeo Farmatic)

El sincronizador recibirá **un SELECT con JOIN por operación** y separará internamente cabeceras y líneas. Este documento define la correspondencia sin suponer nombres de tablas que aún no han sido proporcionados.

| Campo normalizado | Origen a definir | Obligatorio |
|---|---|---|
| documento_id | Clave de ticket/recepción con empresa si es necesario | Sí |
| linea_id | Clave estable de línea, exclusiva dentro del documento | Para líneas |
| fecha_hora | Fecha comercial/hora original | Sí |
| cliente_id | Cliente del ticket | Si existe |
| proveedor_id | Proveedor de la recepción | Si existe |
| articulo_id | ID local del producto, nunca asumir CN | Para líneas |
| cantidad | Unidades con el signo que da el ERP | Para líneas |
| precio_unitario | PVP/coste previo a descuento | Según origen |
| descuento_linea | Importe o porcentaje etiquetado | Si existe |
| importe_neto | Importe neto real de línea | Si existe |
| impuesto_linea | Importe o tipo impositivo identificado | Si existe |
| descuento_global | Descuento de cabecera, una sola vez por documento | Si existe |
| total_documento | Importe total de cabecera | Si existe |
| estado | Válido/anulado/devuelto/corregido según ERP | Si existe |
| modificado_en | Marca de cambio en cabecera o líneas | Esencial para incremental de cambios |

El código `JoinedDocumentNormalizer` detecta líneas duplicadas por JOIN, cabeceras inconsistentes y documentos todavía sin detalle. **No suma el descuento global tantas veces como líneas haya**. Conserva los signos de ventas, devoluciones y correcciones.

La clave PostgreSQL prevista incorpora `cliente` (resuelto desde el esquema de destino), `farmacia_codigo` (siempre desde configuración), `sistema_origen`, `documento_id`; para la línea se añade `linea_id`. Los modelos físicos separados requieren una migración aditiva y un publicador transaccional; hasta entonces las consultas heredadas siguen siendo la fuente para reportes. No se inventará ningún JOIN ni coste.

## Detección de cambios
El SELECT incremental tendrá que captar documentos cuando cambie **cualquier campo relevante de la cabecera o de sus líneas**, aunque la fecha de venta/recepción sea antigua. Si la base no ofrece una marca de modificación fiable, habrá una conciliación completa periódica. Solo un DELETE lógico o un estado explícito puede representar anulaciones; no inferir una venta negativa como anulación de otra línea.

## Compras y descuentos
La cabecera de recepción no constituye prueba de compras por artículo. No calcular PMC ni cantidad comprada a partir de ella. Si se reciben descuentos globales, guardarlos en cabecera y distribuirlos por criterio documentado (por ejemplo, proporcional al importe bruto elegible de las líneas, con ajuste de redondeo) **solo tras verificar las reglas de Farmatic**.

## Pedidos y stock
Los pedidos pendientes constituirán un flujo independiente con cabeceras/líneas. El stock se capturará con marca de tiempo y no como compra/venta; un pedido no recibido no alterará existencias.

## Validación previa al despliegue
Ejecutar comparaciones por farmacia/fecha de número de documentos, unidades firmadas, total neto, descuentos, devoluciones y artículos sin maestro; repetir la importación y comprobar 0 cambios. Asegurar que un cambio solo en cabecera modifica la fila de cabecera y que un JOIN duplicado queda rechazado.
