# Maestro de proveedores por categorías (2026-10-29)

## Vistas

**Todos** recoge proveedores definitivos activos y una sección de orígenes ERP aún sin asociar. Se puede buscar por nombre, código y farmacia, editar el nombre y clasificar un proveedor como laboratorio, mayorista/cooperativa, interno, vacunas, fórmulas o sin clasificar.

**Laboratorios** incluye los tipos DIRECTO, VACUNAS y FÓRMULAS. Solo en esta vista se seleccionan identidades para unificarlas, se revisan coincidencias de nombres y se configura la frecuencia (bajo demanda, de 1 a 10 días, 14, 21 o 30 días). La identidad definitiva recibe la frecuencia; cuando hay una frecuencia anterior, la fusión manual conserva preferentemente la del destino.

**Mayoristas** e **Internos** permiten buscar, clasificar y asociar códigos de ERP a cada proveedor, sin una herramienta de unificación. No se realizan pedidos conjuntos de estos tipos.

**Sin clasificar** muestra entidades pendientes de tipificar. **Sin vincular** muestra códigos de Farmatic que aún no están asociados a una identidad. Se pueden asociar a un proveedor existente o clasificar de forma independiente mediante una operación atómica (identidad y alias en una transacción).

Las ventas, compras, recepciones, CN y otros movimientos históricos del ERP no se modifican al cambiar la clasificación.

## Conciliación automática inicial de laboratorios

La unión automática inicial, con criterio 'name-and-shared-erp-code-v2-20261029', exige simultáneamente:

1. Entidades activas clasificadas como laboratorios **de la misma clase** (DIRECTO/VACUNAS/FÓRMULAS).
2. Nombre canónico equivalente, suprimiendo únicamente prefijos genéricos y la forma jurídica del final.
3. **Al menos un código de proveedor ERP igual en farmacias distintas**, tras normalizar ceros iniciales.
4. Ninguna asociación de origen hecha manualmente.
5. Ningún borrador, frecuencia de pedidos ni confirmación histórica por trasladar.

Se descartan automáticamente los grupos sin corroboración del código, con clases distintas, alias manuales o planificación/historial de pedidos. El hecho de compartir código entre farmacias **sin coincidencia de nombre no es suficiente**: el código es local y puede reutilizarse.

La ejecución es un lote transaccional idempotente, auditado, con tablas de pares y alias movidos para poder restaurarlo si no hay cambios manuales posteriores. Las identidades origen permanecen inactivas con vínculo a la identidad destino. No se borran datos originales de Farmatic.

## Seguridad y reversión

Los endpoints comprueban cliente, rol y farmacia autorizada. La API de fusiones solo permite laboratorios de la misma clase, incluso si se invoca manualmente sin UI.

Se conserva el historial de fusiones. Revertir código puede hacerse redeplegando una versión previa sin eliminar tablas; revertir asociaciones de un lote concreto requiere FM_LAB_MERGE_ACTION=rollback y FM_LAB_MERGE_BATCH_ID, y se bloquea si sus alias han cambiado desde entonces.

## Maquetación

Maestro y agenda usan estilos específicos y adaptables; pestañas desplazables, tablas con scroll horizontal interno y cabeceras fijas, cuatro accesos rápidos, desplegables de alias, diálogos con espacios uniformes y botones adaptativos. La comprobación automática prueba escritorio, tableta y móvil.
