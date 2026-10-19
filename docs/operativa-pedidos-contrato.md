# FARMÉTRICA · Operativa y contrato para conectar el sincronizador

## Publicación actual
La interfaz React y la API Express usan **FM / PostgreSQL de Contabo**. No dependen de Supabase ni Next.js.

La migración aditiva `api/src/migrations/016_operativa_manual.sql` crea las tablas del esquema `farmetrica`:
`op_oportunidades`, `op_pedidos`, `op_trabajo`, `op_traspasos`, `op_politicas_reposicion`,
`op_eventos` y `op_resultados_verificados`. Se incorpora a CI y al despliegue transaccional y puede ejecutarse repetidamente.

Los procesos manuales se autorizan por sesión verificada, cliente y farmacia. Las operaciones guardadas muestran sus valores reales; el botón **Ver ejemplo de demo** presenta ejemplos ficticios etiquetados, sin escrituras de esos datos. En caso de no estar activado el esquema, se conserva el modo demo.

**Reversión sin pérdida:** activar la variable `FM_OPERATIVA_DESACTIVADA=true` en el servicio API deshabilita temporalmente altas y modificaciones y devuelve los nuevos módulos a demo. No elimina datos guardados. No pegar claves ni contraseñas en Git.

## Contratos para integrar datos más adelante
Cada movimiento importado debe tener `cliente_slug`, un código de farmacia inequívoco, identificador del origen y fecha completa. No enviar movimientos transaccionales a las tablas de operativa.

| Fuente esperada | Campos mínimos | Uso posterior |
|---|---|---|
| Ventas | identificador de ticket, línea, producto, unidades netas, fecha, neto y costes históricos disponibles | demanda, margen y verificación |
| Recepciones | documento/línea, producto, proveedor, fecha, unidades, coste neto de adquisición | compras y conciliación |
| Inventario | artículo, farmacia, unidades disponibles, fecha de corte, coste de valoración | stock, roturas y sobrestock |
| Pedidos ERP | proveedor, artículo, unidades, fecha esperada y recibidas, estado | evitar doble recomendación |
| Reservas | artículo, farmacia, unidades reservadas y fecha | cobertura |
| Maestro | CN/EAN, clasificación medicamento/parafarmacia, fuente, confianza y equivalencias por farmacia | filtros y análisis ABCD |
| Proveedores | código origen, coste neto confirmado, descuentos, mínimos, embalaje, plazo y disponibilidad | recomendación de asignación |

No usar números de CN ni umbrales fijos sin fuente fiable para afirmar si un artículo es medicamento. Mantener los artículos «sin clasificar» hasta que el maestro oficial o una clasificación autorizada los determine.

## Preparador de compras
Separa la **necesidad** (artículo y unidades requeridas) de sus **asignaciones a proveedores**. Reducir la asignación de un proveedor a cero no borra la necesidad. El total asignado nunca puede superar lo necesario. Un pedido pasa por borrador, pendiente de aprobación, aprobado y exportado. Aprobar o marcar exportado **no lo envía al ERP**.

Cuando lleguen los datos se usará, entre otras comprobaciones, la demanda durante el intervalo de pedido más el plazo de entrega, más stock de seguridad, descontando stock disponible, reservas y recepciones previstas. Las fechas desconocidas o los precios históricos reducen la confianza. La cobertura saludable de sobrestock no es lo mismo que la cobertura de reposición.

## Oportunidades y resultado económico
- Cada regla tiene una clave estable y episodios separados.
- Mientras exista un episodio abierto, no se genera otro de la misma regla para esa farmacia.
- Tras una resolución, el motor espera al menos 7 días de estabilidad para volver a detectar esa regla.
- Aplicar una acción no contabiliza ahorro verificado.
- El ahorro real exige un periodo base y otro posterior comparables, método, evidencia y clave de deduplicación.
- Ahorro, mejora de margen, ventas en riesgo y capital liberado son magnitudes distintas y nunca se suman indiscriminadamente.
- Traspasos requieren aprobación humana y comprobación operativa/regulatoria. Marcarlos realizados no modifica automáticamente el stock en el ERP.

## Pruebas y controles
El CI ejecuta pruebas de reparto, estados, exportación segura, migración idempotente, aislamiento con dos farmacias, historial, aprobación y comprobación de que no se genera ahorro ficticio. Las pruebas del navegador verifican flujo real y modo demo.

En producción se debe revisar: acceso cliente cruzado, roles lector/gestor/administrador, usuarios con varias farmacias, retención de historial, errores de datos y conciliación futura con recepciones. El despliegue estándar utiliza `docker compose` de los servicios API/web; el compose opcional del asistente es independiente.

**SQL nuevo:** sí, migración 016.  
**Actualizar análisis existente:** no. No se reprocesan datos de Farmatic ni se modifican los snapshots.
